import { describe, it, expect, vi } from 'vitest';
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

describe('reconnectDelay (08 §3.1)', () => {
  it('指数退避 + jitter，封顶 30s', () => {
    expect(reconnectDelay(0, () => 1)).toBe(500);
    expect(reconnectDelay(1, () => 1)).toBe(1000);
    expect(reconnectDelay(100, () => 1)).toBe(30_000); // 封顶
    expect(reconnectDelay(1, () => 0)).toBe(500);
  });
});
