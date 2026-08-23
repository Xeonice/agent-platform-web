import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  PtySocket,
  reconnectDelay,
  type SocketLike,
  type SocketFactoryArgs,
} from '@/services/ws/ptySocket';
import type { TerminalClientFrame, TerminalServerFrame } from '@/types/ws-protocol';

/** 可控 socket.io mock（依赖注入替代 mock.module，12 §3.1.1）。 */
class MockSocket implements SocketLike {
  private connectCb: (() => void) | null = null;
  private disconnectCb: (() => void) | null = null;
  private connectErrorCb: ((err?: unknown) => void) | null = null;
  private frameCb: ((frame: unknown) => void) | null = null;
  readonly emitted: TerminalClientFrame[] = [];
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
  onFrame(cb: (frame: unknown) => void): void {
    this.frameCb = cb;
  }
  emitFrame(frame: TerminalClientFrame): void {
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

describe('PtySocket (08 §3, socket.io transport)', () => {
  it('connect→open 后 emit input，服务端 frame(data) 经 zod 回调（双向 frame 事件）', () => {
    const mock = new MockSocket();
    const frames: TerminalServerFrame[] = [];
    const socket = new PtySocket({
      uri: 'http://x/terminal',
      query: { sandboxId: 's1', xSchemaHash: 'sb-terminal-v1' },
      socketFactory: () => mock,
      onFrame: (f) => frames.push(f),
      onState: () => undefined,
    });
    socket.connect();
    mock.triggerConnect();

    expect(socket.send({ type: 'input', data: 'ls\n' })).toBe(true);
    expect(mock.emitted).toContainEqual({ type: 'input', data: 'ls\n' });

    // 服务端 echo（socket.io 已反序列化为对象）
    mock.serverEmit({ type: 'data', data: 'ls\n' });
    expect(frames).toEqual([{ type: 'data', data: 'ls\n' }]);
  });

  it('未 open 时 send 丢弃返回 false（断线不排队，08 §11.2）', () => {
    const mock = new MockSocket();
    const socket = new PtySocket({
      uri: 'http://x/terminal',
      query: {},
      socketFactory: () => mock,
      onFrame: () => undefined,
      onState: () => undefined,
    });
    socket.connect(); // 尚未 connect 事件
    expect(socket.send({ type: 'input', data: 'x' })).toBe(false);
    expect(mock.emitted).toHaveLength(0);
  });

  it('非法帧不进下游、触发 onInvalidFrame（08 §3.1）', () => {
    const mock = new MockSocket();
    const onFrame = vi.fn();
    const onInvalidFrame = vi.fn();
    const socket = new PtySocket({
      uri: 'http://x/terminal',
      query: {},
      socketFactory: () => mock,
      onFrame,
      onInvalidFrame,
      onState: () => undefined,
    });
    socket.connect();
    mock.triggerConnect();
    mock.serverEmit({ type: 'nope', foo: 1 });
    expect(onFrame).not.toHaveBeenCalled();
    expect(onInvalidFrame).toHaveBeenCalledOnce();
  });

  it('disconnect 触发 reconnecting 状态并计数（onState）', () => {
    const mock = new MockSocket();
    const states: string[] = [];
    const socket = new PtySocket({
      uri: 'http://x/terminal',
      query: {},
      socketFactory: () => mock,
      onFrame: () => undefined,
      onState: (s) => states.push(s),
    });
    socket.connect();
    mock.triggerConnect();
    mock.triggerDisconnect();
    expect(states).toContain('reconnecting');
    expect(socket.reconnectAttempts).toBe(1);
  });

  it('session 首帧存下 socketSessionKey，重连时并入 query 且保留基础 query（08 §11.6）', () => {
    const argsLog: SocketFactoryArgs[] = [];
    let mock = new MockSocket();
    const socket = new PtySocket({
      uri: 'http://x/terminal',
      query: { sandboxId: 's1', xSchemaHash: 'sb-terminal-v1' },
      socketFactory: (args) => {
        argsLog.push(args);
        mock = new MockSocket();
        return mock;
      },
      onFrame: () => undefined,
      onState: () => undefined,
    });
    socket.connect();
    mock.triggerConnect();
    mock.serverEmit({ type: 'session', socketSessionKey: 'KEY-123' });
    expect(socket.getSocketSessionKey()).toBe('KEY-123');

    // 首连不带 key
    expect(argsLog[0]?.query).not.toHaveProperty('socketSessionKey');
    // 模拟 hook 触发的重连：带回 key，基础 query 保留
    socket.connect();
    expect(argsLog[1]?.query['socketSessionKey']).toBe('KEY-123');
    expect(argsLog[1]?.query['sandboxId']).toBe('s1');
    expect(argsLog[1]?.query['xSchemaHash']).toBe('sb-terminal-v1');
  });

  it('connect_error 含未授权文案 → 触发 onUnauthorized（口令门 11 §3.1）', () => {
    const mock = new MockSocket();
    const onUnauthorized = vi.fn();
    const socket = new PtySocket({
      uri: 'http://x/terminal',
      query: {},
      socketFactory: () => mock,
      onFrame: () => undefined,
      onState: () => undefined,
      onUnauthorized,
    });
    socket.connect();
    mock.triggerConnectError(new Error('unauthorized'));
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(socket.connState).toBe('reconnecting');
  });

  it('connect_error 带 SCHEMA_MISMATCH → 走 onHandshakeError，**绝不**弹解锁门', () => {
    // 三条通道共用同一条纪律：认得出码就必须往上说，且未授权与协议漂移不许混为一谈。
    // 以前本类只问 `isUnauthorizedError`，这个码在 /terminal 上是彻底静默的。
    const mock = new MockSocket();
    const onUnauthorized = vi.fn();
    const onHandshakeError = vi.fn();
    const socket = new PtySocket({
      uri: 'http://x/terminal',
      query: {},
      socketFactory: () => mock,
      onFrame: () => undefined,
      onState: () => undefined,
      onUnauthorized,
      onHandshakeError,
    });
    socket.connect();
    mock.triggerConnectError(
      Object.assign(new Error('SCHEMA_MISMATCH: expected sb-terminal-v1, got v0'), {
        data: { code: 'SCHEMA_MISMATCH' },
      }),
    );
    expect(onHandshakeError).toHaveBeenCalledWith('SCHEMA_MISMATCH');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('未授权只走 onUnauthorized（不重复喂给 onHandshakeError）', () => {
    const mock = new MockSocket();
    const onUnauthorized = vi.fn();
    const onHandshakeError = vi.fn();
    const socket = new PtySocket({
      uri: 'http://x/terminal',
      query: {},
      socketFactory: () => mock,
      onFrame: () => undefined,
      onState: () => undefined,
      onUnauthorized,
      onHandshakeError,
    });
    socket.connect();
    mock.triggerConnectError(new Error('unauthorized'));
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(onHandshakeError).not.toHaveBeenCalled();
  });

  it('connect_error 为普通传输错误 → 不误判为未授权', () => {
    const mock = new MockSocket();
    const onUnauthorized = vi.fn();
    const socket = new PtySocket({
      uri: 'http://x/terminal',
      query: {},
      socketFactory: () => mock,
      onFrame: () => undefined,
      onState: () => undefined,
      onUnauthorized,
    });
    socket.connect();
    mock.triggerConnectError(new Error('websocket error'));
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(socket.connState).toBe('reconnecting');
  });

  it('exit 帧被转发给 onFrame', () => {
    const mock = new MockSocket();
    const frames: TerminalServerFrame[] = [];
    const socket = new PtySocket({
      uri: 'http://x/terminal',
      query: {},
      socketFactory: () => mock,
      onFrame: (f) => frames.push(f),
      onState: () => undefined,
    });
    socket.connect();
    mock.triggerConnect();
    mock.serverEmit({ type: 'exit', code: 137 });
    expect(frames).toContainEqual({ type: 'exit', code: 137 });
  });
});

// ————————————————————————————————————————————————————————————————
// 抖动型重连（S6 收尾 ②）：与 taskSocket 同一条 STABLE_CONNECTION_MS 纪律。
// 老写法把 attempt 清零挂在 onConnect 上 ⇒ "连上即掉"时退避恒定在几百毫秒、
// 永远撞不到上限 ⇒ 终端一边每秒重建 pty，一边永远显示"正在重连…（第 1 次）"。
// ————————————————————————————————————————————————————————————————
describe('PtySocket · 抖动型重连', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeFlapping(): { socket: PtySocket; flap: () => void; mock: () => MockSocket } {
    let current = new MockSocket();
    const socket = new PtySocket({
      uri: 'http://x/terminal',
      query: { sandboxId: 's1' },
      socketFactory: () => {
        current = new MockSocket();
        return current;
      },
      onFrame: () => undefined,
      onState: () => undefined,
    });
    socket.connect();
    return {
      socket,
      flap: () => {
        current.triggerConnect();
        current.triggerDisconnect();
      },
      mock: () => current,
    };
  }

  it('连上即掉 ⇒ 退避计数持续增长（不被 onConnect 清零）', () => {
    vi.useFakeTimers();
    const { socket, flap } = makeFlapping();

    flap();
    flap();
    flap();

    // 老写法恒为 1。
    expect(socket.reconnectAttempts).toBe(3);
  });

  it('抖动够多轮后越过 maxReconnect ⇒ 上层收得了手（否则那条"连接超时"永远到不了）', () => {
    vi.useFakeTimers();
    const { socket, flap } = makeFlapping();
    for (let i = 0; i < 12; i += 1) flap();
    expect(socket.reconnectAttempts).toBeGreaterThan(8);
  });

  it('**站得住**的连接掉线 ⇒ 退避清零（正常网络抖动不会被当成故障累加）', () => {
    vi.useFakeTimers();
    const { socket, flap, mock } = makeFlapping();

    flap();
    flap();
    expect(socket.reconnectAttempts).toBe(2);

    mock().triggerConnect();
    vi.advanceTimersByTime(30_000); // 这条连接活了 30 秒 —— 算连成了
    mock().triggerDisconnect();

    expect(socket.reconnectAttempts).toBe(1);
  });

  it('从未连上过（一直握手失败）⇒ 照旧累加，行为不变', () => {
    const mock = new MockSocket();
    const socket = new PtySocket({
      uri: 'http://x/terminal',
      query: {},
      socketFactory: () => mock,
      onFrame: () => undefined,
      onState: () => undefined,
    });
    socket.connect();
    mock.triggerConnectError(new Error('websocket error'));
    mock.triggerConnectError(new Error('websocket error'));
    expect(socket.reconnectAttempts).toBe(2);
  });
});

// ————————————————————————————————————————————————————————————————
// 手动重连（08 §11.6 的终点态 [手动重连]）：退避耗尽后把决定权交回用户。
// ————————————————————————————————————————————————————————————————
describe('PtySocket · 手动重连', () => {
  it('清零退避预算后重连 ⇒ 一次点击换来完整的一轮预算，而不是一次尝试', () => {
    const sockets: MockSocket[] = [];
    const socket = new PtySocket({
      uri: 'http://x/terminal',
      query: {},
      socketFactory: () => {
        const m = new MockSocket();
        sockets.push(m);
        return m;
      },
      onFrame: () => undefined,
      onState: () => undefined,
    });
    socket.connect();
    for (let i = 0; i < 9; i += 1)
      sockets.at(-1)?.triggerConnectError(new Error('websocket error'));
    expect(socket.reconnectAttempts).toBe(9);
    socket.close();
    expect(socket.connState).toBe('closed');

    socket.reconnect();

    expect(socket.reconnectAttempts).toBe(0);
    expect(socket.connState).toBe('connecting');
    expect(sockets).toHaveLength(2); // close 之后又真的建了一条
  });

  it('⚠️ 手动重连**照旧带回 socketSessionKey**（重连窗口没过就接回原来那个 shell，08 §11.6）', () => {
    const argsLog: SocketFactoryArgs[] = [];
    let mock = new MockSocket();
    const socket = new PtySocket({
      uri: 'http://x/terminal',
      query: { sandboxId: 's1', xSchemaHash: 'sb-terminal-v1' },
      socketFactory: (args) => {
        argsLog.push(args);
        mock = new MockSocket();
        return mock;
      },
      onFrame: () => undefined,
      onState: () => undefined,
    });
    socket.connect();
    mock.triggerConnect();
    mock.serverEmit({ type: 'session', socketSessionKey: 'KEY-123' });
    socket.close(); // 退避耗尽，上层收手

    socket.reconnect();

    expect(argsLog[1]?.query['socketSessionKey']).toBe('KEY-123');
    expect(argsLog[1]?.query['sandboxId']).toBe('s1');
  });

  it('手动重连后掉线 ⇒ 重新进入重连态（不是一次性的死连接）', () => {
    let mock = new MockSocket();
    const states: string[] = [];
    const socket = new PtySocket({
      uri: 'http://x/terminal',
      query: {},
      socketFactory: () => {
        mock = new MockSocket();
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

describe('reconnectDelay (08 §3.1)', () => {
  it('指数退避 + jitter，封顶 30s', () => {
    expect(reconnectDelay(0, () => 1)).toBe(500);
    expect(reconnectDelay(1, () => 1)).toBe(1000);
    expect(reconnectDelay(100, () => 1)).toBe(30_000); // 封顶
    expect(reconnectDelay(1, () => 0)).toBe(500);
  });
});
