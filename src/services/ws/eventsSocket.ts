// /events 通道传输层（10 §7.4）：唯一 socket.io 触点之一（与 ptySocket 同层同模式）。
// namespace `/events`；服务端经单一 socket.io 事件 `event` 广播 SandboxEvent（判别键 `event`）。
// 复用 ptySocket 那套：socket.io + reconnection:false（重连由 hook 依退避驱动）+ zod 兜底 + 未授权识别。
// 若后端 socket.io 事件名与 `event` 不同，仅需改本文件 defaultEventsSocketFactory 一处。
import { io } from 'socket.io-client';
import { SandboxEventSchema, type SandboxEvent } from '@/types/ws-protocol';
import { isUnauthorizedError } from '@/services/ws/socketAuth';
import type { ConnState } from '@/types/terminal';

export type { ConnState };

/** 最小 socket 契约（真实 socket.io Socket 经适配器满足，测试 mock 直接实现）。 */
export interface EventsSocketLike {
  onConnect(cb: () => void): void;
  onDisconnect(cb: () => void): void;
  onConnectError(cb: (err?: unknown) => void): void;
  /** 服务端 `event` 事件（携带一条 SandboxEvent，尚未 zod 校验）。 */
  onEvent(cb: (raw: unknown) => void): void;
  disconnect(): void;
}

export interface EventsSocketFactoryArgs {
  uri: string;
}
export type EventsSocketFactory = (args: EventsSocketFactoryArgs) => EventsSocketLike;

export interface EventsSocketOptions {
  /** `<origin>/events`。 */
  uri: string;
  socketFactory?: EventsSocketFactory;
  onEvent: (event: SandboxEvent) => void;
  onState: (state: ConnState, attempt: number) => void;
  /** 契约校验失败回调（dev fail-fast / prod 上报，10 §7.4）。 */
  onInvalidFrame?: (raw: unknown) => void;
  /** WS 握手被口令门拒绝（未授权）时回调（11 §3.1）。 */
  onUnauthorized?: () => void;
  maxReconnect?: number;
}

const MAX_RECONNECT_DEFAULT = 8;

/** 把真实 socket.io Socket 适配为 EventsSocketLike（services 层，唯一 socket.io 触点，07 §3 规则 5）。 */
function defaultEventsSocketFactory({ uri }: EventsSocketFactoryArgs): EventsSocketLike {
  const socket = io(uri, {
    transports: ['websocket'],
    reconnection: false, // 重连由 useSandboxEventsSocket 依退避驱动（对齐 ptySocket）
    forceNew: true,
    // 握手带上 HttpOnly `ap_session` cookie（口令门 11 §3.1）：跨源 WS 须显式带凭据。
    withCredentials: true,
  });
  return {
    onConnect: (cb) => {
      socket.on('connect', cb);
    },
    onDisconnect: (cb) => {
      socket.on('disconnect', () => {
        cb();
      });
    },
    onConnectError: (cb) => {
      socket.on('connect_error', (err: unknown) => {
        cb(err);
      });
    },
    onEvent: (cb) => {
      socket.on('event', (raw: unknown) => {
        cb(raw);
      });
    },
    disconnect: () => {
      socket.disconnect();
    },
  };
}

/**
 * /events 连接生命周期。与 PtySocket 同构但更简单：只收不发、无会话凭据。
 * 重连调度交由 hook（依退避 + 卸载终止）。
 */
export class EventsSocket {
  private socket: EventsSocketLike | null = null;
  private state: ConnState = 'idle';
  private attempt = 0;
  private closedByUser = false;
  private readonly opts: Required<Pick<EventsSocketOptions, 'maxReconnect' | 'socketFactory'>> &
    EventsSocketOptions;

  constructor(opts: EventsSocketOptions) {
    this.opts = {
      ...opts,
      socketFactory: opts.socketFactory ?? defaultEventsSocketFactory,
      maxReconnect: opts.maxReconnect ?? MAX_RECONNECT_DEFAULT,
    };
  }

  connect(): void {
    this.closedByUser = false;
    this.setState('connecting');
    const socket = this.opts.socketFactory({ uri: this.opts.uri });
    this.socket = socket;
    socket.onConnect(() => {
      this.attempt = 0;
      this.setState('open');
    });
    socket.onEvent((raw) => {
      this.handleEvent(raw);
    });
    socket.onConnectError((err) => {
      if (isUnauthorizedError(err)) this.opts.onUnauthorized?.();
      this.handleClose();
    });
    socket.onDisconnect(() => {
      this.handleClose();
    });
  }

  close(): void {
    this.closedByUser = true;
    this.setState('closed');
    this.socket?.disconnect();
    this.socket = null;
  }

  get connState(): ConnState {
    return this.state;
  }

  get reconnectAttempts(): number {
    return this.attempt;
  }

  private handleClose(): void {
    if (this.closedByUser) return;
    this.setState('reconnecting');
  }

  private handleEvent(raw: unknown): void {
    const result = SandboxEventSchema.safeParse(raw);
    if (!result.success) {
      this.opts.onInvalidFrame?.(raw); // 非法帧不进下游、不阻断
      return;
    }
    this.opts.onEvent(result.data);
  }

  private setState(state: ConnState): void {
    this.state = state;
    if (state === 'reconnecting') this.attempt += 1;
    this.opts.onState(state, this.attempt);
  }
}
