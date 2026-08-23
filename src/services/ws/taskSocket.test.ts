import { describe, it, expect, vi, afterEach } from 'vitest';
import { TaskSocket } from '@/services/ws/taskSocket';
import { TASK_STATUSES } from '@/types/ws-protocol';
import type { TaskStatus } from '@/types/task';
import type { TaskSocketLike } from '@/types/taskSocket';
import type { TaskClientFrame, TaskServerFrame } from '@/types/ws-protocol';

/** 可控 /tasks socket mock（依赖注入替代 mock.module，12 §3.1.1）。 */
class MockTaskSocket implements TaskSocketLike {
  private connectCb: (() => void) | null = null;
  private disconnectCb: (() => void) | null = null;
  private connectErrorCb: ((err?: unknown) => void) | null = null;
  private frameCb: ((raw: unknown) => void) | null = null;
  readonly emitted: TaskClientFrame[] = [];
  disconnected = false;

  onConnect(cb: () => void): void {
    this.connectCb = cb;
  }
  onDisconnect(cb: () => void): void {
    this.disconnectCb = cb;
  }
  onConnectError(cb: (err?: unknown) => void): void {
    this.connectErrorCb = cb;
  }
  onFrame(cb: (raw: unknown) => void): void {
    this.frameCb = cb;
  }
  emitFrame(frame: TaskClientFrame): void {
    this.emitted.push(frame);
  }
  disconnect(): void {
    this.disconnected = true;
  }

  triggerConnect(): void {
    this.connectCb?.();
  }
  triggerDisconnect(): void {
    this.disconnectCb?.();
  }
  triggerConnectError(err?: unknown): void {
    this.connectErrorCb?.(err);
  }
  serverEmit(raw: unknown): void {
    this.frameCb?.(raw);
  }
}

function makeSocket(overrides: {
  onFrame?: (f: TaskServerFrame) => void;
  onInvalidFrame?: (raw: unknown) => void;
  onUnauthorized?: () => void;
  onHandshakeError?: (code: string) => void;
  onState?: (state: string, attempt: number) => void;
}): { socket: TaskSocket; mock: MockTaskSocket } {
  const mock = new MockTaskSocket();
  const socket = new TaskSocket({
    uri: 'http://x/tasks',
    query: { xSchemaHash: 'sb-tasks-v1' },
    socketFactory: () => mock,
    onFrame: overrides.onFrame ?? ((): void => undefined),
    onState: overrides.onState ?? ((): void => undefined),
    ...(overrides.onInvalidFrame === undefined ? {} : { onInvalidFrame: overrides.onInvalidFrame }),
    ...(overrides.onUnauthorized === undefined ? {} : { onUnauthorized: overrides.onUnauthorized }),
    ...(overrides.onHandshakeError === undefined
      ? {}
      : { onHandshakeError: overrides.onHandshakeError }),
  });
  return { socket, mock };
}

describe('TaskSocket (/tasks 通道，S6)', () => {
  it('合法 TaskServerFrame 经 zod 后投递 onFrame', () => {
    const frames: TaskServerFrame[] = [];
    const { socket, mock } = makeSocket({ onFrame: (f) => frames.push(f) });
    socket.connect();
    mock.triggerConnect();

    mock.serverEmit({
      type: 'event',
      taskId: 't-1',
      seq: 1,
      event: { type: 'stdout-chunk', timestamp: '2026-08-22T00:00:00Z', data: { text: 'hi' } },
    });

    expect(frames).toHaveLength(1);
    expect(frames[0]?.type).toBe('event');
  });

  it('非法帧被 zod 挡下：不进下游，走 onInvalidFrame', () => {
    const frames: TaskServerFrame[] = [];
    const invalid = vi.fn();
    const { socket, mock } = makeSocket({
      onFrame: (f) => frames.push(f),
      onInvalidFrame: invalid,
    });
    socket.connect();
    mock.triggerConnect();

    // seq 缺失 ⇒ 不符合 event 帧形状。
    mock.serverEmit({ type: 'event', taskId: 't-1' });

    expect(frames).toHaveLength(0);
    expect(invalid).toHaveBeenCalledOnce();
  });

  it('exit 帧的 exitCode 可缺席（不被 schema 拒掉、也不被补默认值）', () => {
    const frames: TaskServerFrame[] = [];
    const { socket, mock } = makeSocket({ onFrame: (f) => frames.push(f) });
    socket.connect();
    mock.triggerConnect();

    mock.serverEmit({ type: 'exit', taskId: 't-1', status: 'timed_out' });

    expect(frames[0]).toEqual({ type: 'exit', taskId: 't-1', status: 'timed_out' });
  });

  it('未 open 时 send 直接丢弃（断线不排队；重连后由 hook 重发 subscribe）', () => {
    const { socket, mock } = makeSocket({});
    socket.connect(); // connecting，还没 open

    expect(socket.send({ type: 'subscribe', taskId: 't-1' })).toBe(false);
    expect(mock.emitted).toHaveLength(0);

    mock.triggerConnect();
    expect(socket.send({ type: 'subscribe', taskId: 't-1', fromSeq: 3 })).toBe(true);
    expect(mock.emitted).toEqual([{ type: 'subscribe', taskId: 't-1', fromSeq: 3 }]);
  });

  it('未授权握手失败 ⇒ onUnauthorized（供上层弹解锁门）', () => {
    const onUnauthorized = vi.fn();
    const { socket, mock } = makeSocket({ onUnauthorized });
    socket.connect();
    mock.triggerConnectError(new Error('unauthorized'));

    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(socket.connState).toBe('reconnecting');
  });

  it('传输层抖动不算未授权（不误弹解锁门）', () => {
    const onUnauthorized = vi.fn();
    const { socket, mock } = makeSocket({ onUnauthorized });
    socket.connect();
    mock.triggerConnectError(new Error('websocket error'));

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('主动 close 后掉线不再进入重连态（避免卸载后仍在退避循环）', () => {
    const states: string[] = [];
    const { socket, mock } = makeSocket({ onState: (s) => states.push(s) });
    socket.connect();
    mock.triggerConnect();
    socket.close();
    mock.triggerDisconnect();

    expect(mock.disconnected).toBe(true);
    expect(states.at(-1)).toBe('closed');
    expect(states).not.toContain('reconnecting');
  });
});

describe('TaskSocket · 抖动型重连（S6 review ④）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 连上即掉一轮。 */
  function flap(mock: MockTaskSocket): void {
    mock.triggerConnect();
    mock.triggerDisconnect();
  }

  it('连上即掉 ⇒ 退避计数持续增长（不被 onConnect 清零）', () => {
    vi.useFakeTimers();
    const { socket, mock } = makeSocket({});
    socket.connect();

    flap(mock);
    flap(mock);
    flap(mock);

    // 老写法在 onConnect 里 this.attempt = 0 ⇒ 这里恒为 1：退避永远不增长、
    // 也永远撞不到 maxReconnect 上限，于是每次抖动都重建 socket + 重发 subscribe 触发完整回放。
    expect(socket.reconnectAttempts).toBe(3);
  });

  it('抖动够多轮后越过上限 ⇒ 上层据此收手（实测抖动 30 轮曾建出 31 条 socket）', () => {
    vi.useFakeTimers();
    const attempts: number[] = [];
    const { socket, mock } = makeSocket({ onState: (_s, a) => attempts.push(a) });
    socket.connect();
    for (let i = 0; i < 12; i += 1) flap(mock);

    // 上层（useTaskStream）用 `nextAttempt > maxReconnect` 决定停手；能越过上限才停得下来。
    expect(Math.max(...attempts)).toBeGreaterThan(8);
  });

  it('**站得住**的连接掉线 ⇒ 退避清零（正常网络抖动不会被当成故障累加）', () => {
    vi.useFakeTimers();
    const { socket, mock } = makeSocket({});
    socket.connect();

    flap(mock);
    flap(mock);
    expect(socket.reconnectAttempts).toBe(2);

    mock.triggerConnect();
    vi.advanceTimersByTime(30_000); // 这条连接活了 30 秒 —— 算连成了
    mock.triggerDisconnect();

    // 清零后本次断开重新计为第 1 次。
    expect(socket.reconnectAttempts).toBe(1);
  });

  it('从未连上过（一直握手失败）⇒ 照旧累加，行为不变', () => {
    vi.useFakeTimers();
    const { socket, mock } = makeSocket({});
    socket.connect();
    mock.triggerConnectError(new Error('websocket error'));
    mock.triggerConnectError(new Error('websocket error'));

    expect(socket.reconnectAttempts).toBe(2);
  });
});

describe('TaskSocket · 握手被拒（后端已改成 middleware，connect_error 送达）', () => {
  it('UNAUTHORIZED：优先读 err.data.code ⇒ 弹解锁门，不当成通道错误', () => {
    const onUnauthorized = vi.fn();
    const onHandshakeError = vi.fn();
    const { socket, mock } = makeSocket({ onUnauthorized, onHandshakeError });
    socket.connect();

    const err = Object.assign(new Error('UNAUTHORIZED: passcode required'), {
      data: { code: 'UNAUTHORIZED' },
    });
    mock.triggerConnectError(err);

    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(onHandshakeError).not.toHaveBeenCalled();
  });

  it('⚠️ SCHEMA_MISMATCH **绝不**弹解锁门：版本漂移解不开，走通道级错误', () => {
    const onUnauthorized = vi.fn();
    const onHandshakeError = vi.fn();
    const { socket, mock } = makeSocket({ onUnauthorized, onHandshakeError });
    socket.connect();

    const err = Object.assign(new Error('SCHEMA_MISMATCH: expected sb-tasks-v1, got sb-tasks-v0'), {
      data: { code: 'SCHEMA_MISMATCH' },
    });
    mock.triggerConnectError(err);

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onHandshakeError).toHaveBeenCalledWith('SCHEMA_MISMATCH');
  });

  it('没有 err.data 时退到 message 开头的码（后端只改了一半也接得住）', () => {
    const onUnauthorized = vi.fn();
    const onHandshakeError = vi.fn();
    const { socket, mock } = makeSocket({ onUnauthorized, onHandshakeError });
    socket.connect();

    mock.triggerConnectError(new Error('SCHEMA_MISMATCH: expected sb-tasks-v1, got sb-tasks-v0'));

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onHandshakeError).toHaveBeenCalledWith('SCHEMA_MISMATCH');
  });

  it('老后端的散文 unauthorized 仍然识别（不能为了新码把旧路径改瞎）', () => {
    const onUnauthorized = vi.fn();
    const { socket, mock } = makeSocket({ onUnauthorized });
    socket.connect();
    mock.triggerConnectError(new Error('unauthorized'));
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('传输层抖动既不弹解锁门也不报通道错误', () => {
    const onUnauthorized = vi.fn();
    const onHandshakeError = vi.fn();
    const { socket, mock } = makeSocket({ onUnauthorized, onHandshakeError });
    socket.connect();
    mock.triggerConnectError(new Error('websocket error'));
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onHandshakeError).not.toHaveBeenCalled();
  });
});

describe('TaskSocket · 未授权的第二条接收路径（后端若改成先发 error 帧也接得住）', () => {
  it('通道级 error 帧的 UNAUTHORIZED ⇒ 触发 onUnauthorized，且帧照旧进下游', () => {
    const onUnauthorized = vi.fn();
    const frames: TaskServerFrame[] = [];
    const { socket, mock } = makeSocket({ onUnauthorized, onFrame: (f) => frames.push(f) });
    socket.connect();
    mock.triggerConnect();

    mock.serverEmit({ type: 'error', taskId: 't-1', code: 'UNAUTHORIZED' });

    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(frames).toEqual([{ type: 'error', taskId: 't-1', code: 'UNAUTHORIZED' }]);
  });

  it('别的通道级 error 码不误弹解锁门', () => {
    const onUnauthorized = vi.fn();
    const { socket, mock } = makeSocket({ onUnauthorized });
    socket.connect();
    mock.triggerConnect();

    mock.serverEmit({ type: 'error', taskId: 't-1', code: 'REPLAY_FAILED' });

    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

// ————————————————————————————————————————————————————————————————
// 生成类型 ↔ WS 运行时枚举的**双向**对齐。
// 单向靠 `satisfies`（多一个/拼错一个当场红）已经在 ws-protocol.ts 里封住；
// 另一向（后端加一个 status、这边没跟上）需要一次穷举断言 —— 少一个值时下面的
// Record 字面量在 tsc 阶段就红，而不是等到运行时 zod 把整帧默默丢掉。
// ————————————————————————————————————————————————————————————————
describe('TaskStatus 闭集对齐（生成类型 ↔ zod 枚举）', () => {
  it('两侧取值完全一致（任一侧多/少一个都在编译期红）', () => {
    // 少一个 ⇒ Record 缺 key ⇒ tsc 红。
    const exhaustive: Record<TaskStatus, true> = {
      running: true,
      succeeded: true,
      failed: true,
      killed: true,
      timed_out: true,
    };
    expect([...TASK_STATUSES].sort()).toEqual(Object.keys(exhaustive).sort());
  });
});

// ————————————————————————————————————————————————————————————————
// 手动重连（S6 收尾 ③ 的补项）：与 PtySocket#reconnect 同款语义。
// 关键差别：终端的现场由后端 tmux 重绘，而这里的正文只在前端内存里 ⇒
// 重连**绝不能**变成"清空重来"，必须靠 hook 层的 fromSeq 续播。
// ————————————————————————————————————————————————————————————————
describe('TaskSocket · 手动重连', () => {
  it('清零退避预算后重连 ⇒ 一次点击换来完整的一轮预算，而不是一次尝试', () => {
    const mocks: MockTaskSocket[] = [];
    const socket = new TaskSocket({
      uri: 'http://x/tasks',
      query: { sandboxId: 'sb-1', xSchemaHash: 'sb-tasks-v1' },
      socketFactory: () => {
        const m = new MockTaskSocket();
        mocks.push(m);
        return m;
      },
      onFrame: () => undefined,
      onState: () => undefined,
    });
    socket.connect();
    for (let i = 0; i < 9; i += 1) mocks.at(-1)?.triggerConnectError(new Error('websocket error'));
    expect(socket.reconnectAttempts).toBe(9);
    socket.close();
    expect(socket.connState).toBe('closed');

    socket.reconnect();

    expect(socket.reconnectAttempts).toBe(0);
    expect(socket.connState).toBe('connecting');
    expect(mocks).toHaveLength(2);
  });

  it('重连照旧带上归属（sandboxId 是连接级属性，每次握手都要重新声明）', () => {
    const calls: { query: Record<string, string> }[] = [];
    const socket = new TaskSocket({
      uri: 'http://x/tasks',
      query: { sandboxId: 'sb-1', xSchemaHash: 'sb-tasks-v1' },
      socketFactory: (args) => {
        calls.push({ query: args.query });
        return new MockTaskSocket();
      },
      onFrame: () => undefined,
      onState: () => undefined,
    });
    socket.connect();
    socket.close();

    socket.reconnect();

    expect(calls[1]?.query['sandboxId']).toBe('sb-1');
    expect(calls[1]?.query['xSchemaHash']).toBe('sb-tasks-v1');
  });

  it('手动重连后掉线 ⇒ 重新进入重连态（不是一次性的死连接）', () => {
    let mock = new MockTaskSocket();
    const states: string[] = [];
    const socket = new TaskSocket({
      uri: 'http://x/tasks',
      query: { xSchemaHash: 'sb-tasks-v1' },
      socketFactory: () => {
        mock = new MockTaskSocket();
        return mock;
      },
      onFrame: () => undefined,
      onState: (s) => states.push(s),
    });
    socket.connect();
    socket.close();

    socket.reconnect();
    mock.triggerDisconnect();

    expect(states.at(-1)).toBe('reconnecting');
    expect(socket.reconnectAttempts).toBe(1);
  });
});
