// /tasks 通道传输层（S6 无头 Task）：socket.io 触点之一，与 ptySocket / eventsSocket 同层同模式。
// namespace `/tasks`；双向单一事件名 `frame`（与 /terminal 一致——该通道也是双向控制帧）。
// 若后端选了别的 socket.io 事件名，**只需改本文件的 defaultTaskSocketFactory 一处**。
//
// 复用既有纪律：reconnection:false（重连由 hook 依退避驱动）+ zod 兜底 + 未授权识别 + withCredentials。
//
// 握手被拒的两条接收路径（后端已按前端建议改成 socket.io **middleware**，
// 拒绝以 `connect_error` 送达、message 以码开头且 `err.data.code` 同码）：
//   ·（现行）`onConnectError` → `readSocketErrorCode` → UNAUTHORIZED 弹解锁门 /
//     其余码（SCHEMA_MISMATCH…）交给 onHandshakeError 走通道级错误的呈现路径；
//   · （兜底）若后端改成断开前先 emit 一帧 `{type:'error', code}`，`handleFrame` 同样接得住。
// 两条都留着：它们对应后端两种实现，任何一种在线上生效都不需要前端再改。
//
// ⚠️ `xSchemaHash` 在 `/tasks` 上是**必填**（不带即拒），见 lib/taskSocketConfig。
import { io } from 'socket.io-client';
import {
  TaskServerFrameSchema,
  type TaskClientFrame,
  type TaskServerFrame,
} from '@/types/ws-protocol';
import { readSocketErrorCode } from '@/services/ws/socketAuth';
import type { ConnState } from '@/types/terminal';
// 最小 socket 契约住在 types/（container 也要拿它注入 mock，见该文件注释）。
import type { TaskSocketFactory, TaskSocketFactoryArgs, TaskSocketLike } from '@/types/taskSocket';

export type { ConnState };
export type { TaskSocketFactory, TaskSocketFactoryArgs, TaskSocketLike };

export interface TaskSocketOptions {
  /** `<origin>/tasks`。 */
  uri: string;
  /** 握手 query（当前只有 xSchemaHash；订阅目标走 subscribe 帧）。 */
  query: Record<string, string>;
  /** 默认真实 io；测试注入 mock（避免 mock.module，12 §3.1.1）。 */
  socketFactory?: TaskSocketFactory;
  onFrame: (frame: TaskServerFrame) => void;
  onState: (state: ConnState, attempt: number) => void;
  /** 契约校验失败回调（dev fail-fast / prod 上报，不阻断渲染）。 */
  onInvalidFrame?: (raw: unknown) => void;
  /** WS 握手被口令门拒绝（未授权）时回调（11 §3.1）。 */
  onUnauthorized?: () => void;
  /**
   * 握手被拒、但原因**不是**未授权（如 `SCHEMA_MISMATCH`）。
   * 与通道级 `error` 帧同义 ⇒ 上层用同一套人话呈现，不另造文案。
   */
  onHandshakeError?: (code: string) => void;
  maxReconnect?: number;
}

const MAX_RECONNECT_DEFAULT = 8;

/**
 * 一条连接活满多久才算"站得住"（成功），从而把退避计数清零。
 *
 * ⚠️ 这个阈值是 ④ 的全部要害：把清零挂在 `onConnect` 上，**抖动型故障**（连上即掉）
 * 会让 attempt 永远停在 0/1 ⇒ 退避恒定在几百毫秒、也永远撞不到 `maxReconnect` 上限，
 * 于是每秒重建一条 socket、每条都重发 subscribe 触发一次完整回放。实测抖动 30 轮 = 31 条 socket。
 */
const STABLE_CONNECTION_MS = 10_000;

function defaultTaskSocketFactory({ uri, query }: TaskSocketFactoryArgs): TaskSocketLike {
  const socket = io(uri, {
    transports: ['websocket'],
    query,
    reconnection: false, // 重连由 useTaskStream 依退避驱动（每次重连都要重发 subscribe，故必须由 hook 掌握）
    forceNew: true,
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
      socket.on('frame', (raw: unknown) => {
        cb(raw);
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

/** /tasks 连接生命周期。与 PtySocket 同构：双向、有 send，但无会话凭据（订阅靠帧）。 */
export class TaskSocket {
  private socket: TaskSocketLike | null = null;
  private state: ConnState = 'idle';
  private attempt = 0;
  private closedByUser = false;
  /** 本次连接 open 的时刻；null = 当前没有已建立的连接。 */
  private connectedAt: number | null = null;
  private readonly opts: Required<Pick<TaskSocketOptions, 'maxReconnect' | 'socketFactory'>> &
    TaskSocketOptions;

  constructor(opts: TaskSocketOptions) {
    this.opts = {
      ...opts,
      socketFactory: opts.socketFactory ?? defaultTaskSocketFactory,
      maxReconnect: opts.maxReconnect ?? MAX_RECONNECT_DEFAULT,
    };
  }

  connect(): void {
    this.closedByUser = false;
    this.setState('connecting');
    const socket = this.opts.socketFactory({ uri: this.opts.uri, query: this.opts.query });
    this.socket = socket;
    socket.onConnect(() => {
      // **不在这里清零 attempt**：连上不等于连成了。清零挪到 handleClose，
      // 只有活过 STABLE_CONNECTION_MS 的连接才作数（见该常量注释）。
      this.connectedAt = Date.now();
      this.setState('open');
    });
    socket.onFrame((raw) => {
      this.handleFrame(raw);
    });
    socket.onConnectError((err) => {
      const code = readSocketErrorCode(err);
      // 未授权 → 弹解锁门；别的码（版本漂移等）→ 通道级错误。
      // **绝不混为一谈**：把版本漂移显示成"需要解锁"，用户会去解锁一个解不了的问题。
      if (code === 'UNAUTHORIZED') this.opts.onUnauthorized?.();
      else if (code !== undefined) this.opts.onHandshakeError?.(code);
      this.handleClose();
    });
    socket.onDisconnect(() => {
      this.handleClose();
    });
  }

  /** fire-and-forget：未 open 时丢弃并返回 false（断线不排队——重连后会重发 subscribe）。 */
  send(frame: TaskClientFrame): boolean {
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
   * 用户点「重新连接」：**清零退避预算**后重连（与 PtySocket#reconnect 同款语义）。
   *
   * 为什么必须清零：退避耗尽后 attempt 已越过上限，直接 `connect()` 一旦失败，
   * 上层的 `nextAttempt > maxReconnect` 立刻又把它关掉 ⇒ 一次点击只换来**一次**尝试。
   *
   * ⚠️ **本方法不碰这条流上的任何记账**。`lastSeq` 住在 hook 层的 ref 里，重连成功后
   * 照旧走 `onState('open')` → `subscribe(taskId, fromSeq)` 那条唯一路径 ⇒
   * 用户已经看了很久的那一屏输出**不会被清空**，后端只补这之后缺的那一截。
   * 这一点比终端更要紧：终端的现场由后端 tmux 重绘，而这里的正文只在前端内存里。
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

  private handleClose(): void {
    if (this.closedByUser) return;
    const connectedAt = this.connectedAt;
    this.connectedAt = null;
    // 只有**站得住**的连接才把退避清零；连上即掉时 attempt 继续累加 ⇒ 退避真的会增长，
    // 也终于撞得到 maxReconnect 上限而停下来。
    if (connectedAt !== null && Date.now() - connectedAt >= STABLE_CONNECTION_MS) {
      this.attempt = 0;
    }
    this.setState('reconnecting');
  }

  private handleFrame(raw: unknown): void {
    const result = TaskServerFrameSchema.safeParse(raw);
    if (!result.success) {
      this.opts.onInvalidFrame?.(raw); // 非法帧不进下游、不阻断渲染
      return;
    }
    const frame = result.data;
    // 后端若改成"断开前先发一帧 error"，未授权就从这条路进来（见文件头注释）。
    // 帧照旧往下游走：通道级 error 有自己的人话（lib/taskOutcome 的通道词表）。
    if (frame.type === 'error' && frame.code === 'UNAUTHORIZED') this.opts.onUnauthorized?.();
    this.opts.onFrame(frame);
  }

  private setState(state: ConnState): void {
    this.state = state;
    if (state === 'reconnecting') this.attempt += 1;
    this.opts.onState(state, this.attempt);
  }
}
