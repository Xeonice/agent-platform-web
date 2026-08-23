// 终端传输层封装（08 §3）：唯一 socket.io 触点。
// 后端 socket.io namespace `/terminal`：`frame` 事件双向；query 带 sandboxId/cols/rows/xSchemaHash(+重连 socketSessionKey)。
// socket 工厂通过参数注入（默认真实 io）——为单测提供 mock 注入点，避免 mock.module（12 §3.1.1）。
import { io } from 'socket.io-client';
import {
  TerminalServerFrameSchema,
  type TerminalClientFrame,
  type TerminalServerFrame,
} from '@/types/ws-protocol';
import { isUnauthorizedError } from '@/services/ws/socketAuth';
import type { ConnState } from '@/types/terminal';

export type { ConnState };

/** 最小 socket 契约（真实 socket.io Socket 经适配器满足，测试 mock 直接实现）。 */
export interface SocketLike {
  onConnect(cb: () => void): void;
  onDisconnect(cb: () => void): void;
  /** connect_error 回调；带回原始错误（用于判别未授权，08 §3.1 / 口令门 11 §3.1）。 */
  onConnectError(cb: (err?: unknown) => void): void;
  onFrame(cb: (frame: unknown) => void): void;
  emitFrame(frame: TerminalClientFrame): void;
  disconnect(): void;
}

export interface SocketFactoryArgs {
  uri: string;
  query: Record<string, string>;
}
export type SocketFactory = (args: SocketFactoryArgs) => SocketLike;

export interface PtySocketOptions {
  /** `<origin>/terminal`。 */
  uri: string;
  /** 基础 query（sandboxId/cols/rows/xSchemaHash）；重连凭据 socketSessionKey 由本类追加。 */
  query: Record<string, string>;
  /** 默认真实 io；测试注入 mock。 */
  socketFactory?: SocketFactory;
  onFrame: (frame: TerminalServerFrame) => void;
  onState: (state: ConnState, attempt: number) => void;
  /** 契约校验失败回调（dev fail-fast / prod 上报，08 §3.1）。 */
  onInvalidFrame?: (raw: unknown) => void;
  /** WS 握手被口令门拒绝（未授权）时回调，供上层弹解锁门（11 §3.1）。 */
  onUnauthorized?: () => void;
  maxReconnect?: number;
}

const MAX_RECONNECT_DEFAULT = 8;

/**
 * 一条连接活满多久才算"站得住"（成功），从而把退避计数清零。
 *
 * ⚠️ 与 taskSocket 的同名常量是**同一件事**（S6 review ④），三个通道统一：把清零挂在
 * `onConnect` 上，**抖动型故障**（连上即掉）会让 attempt 永远停在 0/1 ⇒ 退避恒定在几百毫秒、
 * 也永远撞不到 `maxReconnect` 上限。在终端这条线上后果更重：每重建一条 socket 就是后端
 * 一次 pty attach + 一次全屏重绘，而"连接超时 → 手动重连"那个终点态永远到不了 ⇒
 * 界面会一直显示"正在重连…（第 1 次）"，看上去像在努力，实际是在原地空转。
 */
const STABLE_CONNECTION_MS = 10_000;

/** 把真实 socket.io Socket 适配为 SocketLike（services 层，唯一 socket.io 触点，07 §3 规则 5）。 */
function defaultSocketFactory({ uri, query }: SocketFactoryArgs): SocketLike {
  // reconnection:false —— 重连由 useSandboxTerminalSocket 依会话终止条件驱动（08 §8），每次 connect 用最新 query（带回 key）。
  const socket = io(uri, {
    transports: ['websocket'],
    query,
    reconnection: false,
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
    onFrame: (cb) => {
      socket.on('frame', (frame: unknown) => {
        cb(frame);
      });
    },
    emitFrame: (frame) => {
      socket.emit('frame', frame);
    },
    disconnect: () => {
      socket.disconnect();
    },
  };
}

export class PtySocket {
  private socket: SocketLike | null = null;
  private state: ConnState = 'idle';
  private attempt = 0;
  private closedByUser = false;
  /** 本次连接 open 的时刻；null = 当前没有已建立的连接。 */
  private connectedAt: number | null = null;
  // 后端随开会话首帧下发的重连凭据（08 §3）；仅存内存/不进 persist；重连时并入 query 回带（08 §11.6）。
  private socketSessionKey: string | null = null;
  private readonly opts: Required<Pick<PtySocketOptions, 'maxReconnect' | 'socketFactory'>> &
    PtySocketOptions;

  constructor(opts: PtySocketOptions) {
    this.opts = {
      ...opts,
      socketFactory: opts.socketFactory ?? defaultSocketFactory,
      maxReconnect: opts.maxReconnect ?? MAX_RECONNECT_DEFAULT,
    };
  }

  /** 重连必须带回 socketSessionKey，否则后端认不出同一会话、会开新 pty（08 §11.6）。 */
  private buildQuery(): Record<string, string> {
    if (this.socketSessionKey === null) return this.opts.query;
    return { ...this.opts.query, socketSessionKey: this.socketSessionKey };
  }

  connect(): void {
    this.closedByUser = false;
    this.setState('connecting');
    const socket = this.opts.socketFactory({ uri: this.opts.uri, query: this.buildQuery() });
    this.socket = socket;
    socket.onConnect(() => {
      // **不在这里清零 attempt**：连上不等于连成了。清零挪到 handleClose，
      // 只有活过 STABLE_CONNECTION_MS 的连接才作数（见该常量注释）。
      this.connectedAt = Date.now();
      this.setState('open');
    });
    socket.onFrame((frame) => {
      this.handleFrame(frame);
    });
    socket.onConnectError((err) => {
      if (isUnauthorizedError(err)) this.opts.onUnauthorized?.();
      this.handleClose();
    });
    socket.onDisconnect(() => {
      this.handleClose();
    });
  }

  /** fire-and-forget：未 open 时丢弃并返回 false（断线不排队，08 §11.2）。 */
  send(frame: TerminalClientFrame): boolean {
    if (this.state !== 'open' || this.socket === null) return false;
    this.socket.emitFrame(frame);
    return true;
  }

  close(): void {
    this.closedByUser = true;
    this.connectedAt = null;
    this.setState('closed');
    this.socket?.disconnect();
    this.socket = null;
  }

  /**
   * 用户点「手动重连」：**清零退避预算**后重连（08 §11.6 的终点态 `[手动重连]`）。
   *
   * 为什么必须清零：退避耗尽后 attempt 已越过上限，直接 `connect()` 一旦失败，
   * 上层的 `nextAttempt > maxReconnect` 立刻又把它关掉 ⇒ 一次点击只换来**一次**尝试，
   * 用户得连点。清零＝把完整的一轮退避预算交回给这次显式的人为决定。
   *
   * ⚠️ **不清 `socketSessionKey`**：它才是"接回原来那个 shell"的凭据（08 §11.6）。
   * 重连窗口没过就接回现场，过了则后端开新 pty —— 这个分叉由后端判，前端不替它决定。
   */
  reconnect(): void {
    this.attempt = 0;
    this.connect();
  }

  get connState(): ConnState {
    return this.state;
  }

  get reconnectAttempts(): number {
    return this.attempt;
  }

  /** 供诊断/测试读取当前重连凭据。 */
  getSocketSessionKey(): string | null {
    return this.socketSessionKey;
  }

  private handleClose(): void {
    if (this.closedByUser) return;
    const connectedAt = this.connectedAt;
    this.connectedAt = null;
    // 只有**站得住**的连接才把退避清零；连上即掉时 attempt 继续累加 ⇒ 退避真的会增长，
    // 也终于撞得到 maxReconnect 上限而停下来（停下来之后 UI 给「手动重连」，见 ConnectionStatus.view）。
    if (connectedAt !== null && Date.now() - connectedAt >= STABLE_CONNECTION_MS) {
      this.attempt = 0;
    }
    // 重连调度交由 hook 层依会话终止条件决定（08 §3.1/§8）。
    this.setState('reconnecting');
  }

  private handleFrame(raw: unknown): void {
    // socket.io 已把 JSON 反序列化为对象，直接 zod 校验（08 §3.1）。
    const result = TerminalServerFrameSchema.safeParse(raw);
    if (!result.success) {
      this.opts.onInvalidFrame?.(raw); // 校验失败不进下游、不阻断渲染
      return;
    }
    // session 首帧：存下重连凭据（08 §3）；同时仍向下游转发（registry 可持有）。
    if (result.data.type === 'session') {
      this.socketSessionKey = result.data.socketSessionKey;
    }
    this.opts.onFrame(result.data);
  }

  private setState(state: ConnState): void {
    this.state = state;
    if (state === 'reconnecting') this.attempt += 1;
    this.opts.onState(state, this.attempt);
  }
}

/** 指数退避 + jitter（08 §3.1）：min(30s, 500ms × 2^n) × (0.5~1.0)。 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 500 * 2 ** attempt);
  return Math.round(base * (0.5 + random() * 0.5));
}
