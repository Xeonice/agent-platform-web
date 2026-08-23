// /events 通道传输层（10 §7.4）：唯一 socket.io 触点之一（与 ptySocket 同层同模式）。
// namespace `/events`；服务端经单一 socket.io 事件 `event` 广播 SandboxEvent（判别键 `event`）。
// 复用 ptySocket 那套：socket.io + reconnection:false（重连由 hook 依退避驱动）+ zod 兜底 + 未授权识别。
// 若后端 socket.io 事件名与 `event` 不同，仅需改本文件 defaultEventsSocketFactory 一处。
import { io } from 'socket.io-client';
import { SandboxEventSchema, type SandboxEvent } from '@/types/ws-protocol';
import { readSocketErrorCode } from '@/services/ws/socketAuth';
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
  /**
   * 握手被拒、但原因**不是**未授权（如 `SCHEMA_MISMATCH`）。
   *
   * ⚠️ 在这条通道上不说话的代价最大：/events **永不停手**（见 useSandboxEventsSocket 头注释），
   * 所以一次协议漂移的表现是"整个工作台永远停在启动中，每 30 秒静默失败一次"——
   * 没有任何一处会说出原因。回调本身不改重连策略（那个决定归 hook），只保证话被说出来。
   */
  onHandshakeError?: (code: string) => void;
  // ⚠️ 这里**刻意没有** maxReconnect：/events 不设重试次数上限（理由见 useSandboxEventsSocket 头注释）。
  // 旧版本有过一个从不被本类读取的同名字段，只是把"到底谁在管上限"这件事说糊涂了，已删。
}

/**
 * 一条连接活满多久才算"站得住"（成功），从而把退避计数清零。
 *
 * 与 taskSocket / ptySocket 的同名常量是**同一件事**（S6 review ④）：把清零挂在 `onConnect` 上，
 * **抖动型故障**（连上即掉）会让 attempt 永远停在 0/1 ⇒ 退避恒定在几百毫秒，前端就成了一台
 * 每秒重建一条 socket 的机器。/events 是全局单连接、每次重连都会触发一次后端订阅装配，
 * 空转的代价直接打在后端上。
 */
const STABLE_CONNECTION_MS = 10_000;

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
  /** 本次连接 open 的时刻；null = 当前没有已建立的连接。 */
  private connectedAt: number | null = null;
  private readonly opts: Required<Pick<EventsSocketOptions, 'socketFactory'>> & EventsSocketOptions;

  constructor(opts: EventsSocketOptions) {
    this.opts = {
      ...opts,
      socketFactory: opts.socketFactory ?? defaultEventsSocketFactory,
    };
  }

  connect(): void {
    this.closedByUser = false;
    this.setState('connecting');
    const socket = this.opts.socketFactory({ uri: this.opts.uri });
    this.socket = socket;
    socket.onConnect(() => {
      // **不在这里清零 attempt**：连上不等于连成了。清零挪到 handleClose，
      // 只有活过 STABLE_CONNECTION_MS 的连接才作数（见该常量注释）。
      this.connectedAt = Date.now();
      this.setState('open');
    });
    socket.onEvent((raw) => {
      this.handleEvent(raw);
    });
    socket.onConnectError((err) => {
      const code = readSocketErrorCode(err);
      if (code === 'UNAUTHORIZED') this.opts.onUnauthorized?.();
      else if (code !== undefined) this.opts.onHandshakeError?.(code);
      this.handleClose();
    });
    socket.onDisconnect(() => {
      this.handleClose();
    });
  }

  close(): void {
    this.closedByUser = true;
    this.connectedAt = null;
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
    const connectedAt = this.connectedAt;
    this.connectedAt = null;
    // 只有**站得住**的连接才把退避清零；连上即掉时 attempt 继续累加 ⇒ 退避真的会增长到 30s 封顶，
    // 而不是每秒重建一条 socket。
    if (connectedAt !== null && Date.now() - connectedAt >= STABLE_CONNECTION_MS) {
      this.attempt = 0;
    }
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
