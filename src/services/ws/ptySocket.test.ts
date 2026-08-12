import { describe, it, expect, vi } from 'vitest';
import { PtySocket, reconnectDelay, type WebSocketLike } from '@/services/ws/ptySocket';
import type { TerminalServerFrame } from '@/types/ws-protocol';

/** 可控 mock WebSocket（依赖注入替代 mock.module，12 §3.1.1）。 */
class MockWebSocket implements WebSocketLike {
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  readonly sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.({});
  }
  triggerOpen(): void {
    this.onopen?.({});
  }
  serverPush(raw: string): void {
    this.onmessage?.({ data: raw });
  }
}

describe('PtySocket (08 §3)', () => {
  it('open 后 send input，服务端 echo 为 data 帧经 zod 校验回调', () => {
    const mock = new MockWebSocket();
    const frames: TerminalServerFrame[] = [];
    const socket = new PtySocket({
      url: 'ws://x/terminal',
      webSocketCtor: () => mock,
      onFrame: (f) => frames.push(f),
      onState: () => undefined,
    });
    socket.connect();
    mock.triggerOpen();

    expect(socket.send({ type: 'input', data: 'ls\n' })).toBe(true);
    expect(mock.sent).toContain(JSON.stringify({ type: 'input', data: 'ls\n' }));

    // 服务端 echo
    mock.serverPush(JSON.stringify({ type: 'data', data: 'ls\n' }));
    expect(frames).toEqual([{ type: 'data', data: 'ls\n' }]);
  });

  it('未 open 时 send 丢弃返回 false（断线不排队，08 §11.2）', () => {
    const mock = new MockWebSocket();
    const socket = new PtySocket({
      url: 'ws://x/terminal',
      webSocketCtor: () => mock,
      onFrame: () => undefined,
      onState: () => undefined,
    });
    socket.connect(); // 尚未 open
    expect(socket.send({ type: 'input', data: 'x' })).toBe(false);
    expect(mock.sent).toHaveLength(0);
  });

  it('非法帧不进下游、触发 onInvalidFrame（08 §3.1）', () => {
    const mock = new MockWebSocket();
    const onFrame = vi.fn();
    const onInvalidFrame = vi.fn();
    const socket = new PtySocket({
      url: 'ws://x/terminal',
      webSocketCtor: () => mock,
      onFrame,
      onInvalidFrame,
      onState: () => undefined,
    });
    socket.connect();
    mock.triggerOpen();
    mock.serverPush(JSON.stringify({ type: 'nope', foo: 1 }));
    expect(onFrame).not.toHaveBeenCalled();
    expect(onInvalidFrame).toHaveBeenCalledOnce();
  });

  it('close 触发 reconnecting 状态并计数（onState）', () => {
    const mock = new MockWebSocket();
    const states: string[] = [];
    const socket = new PtySocket({
      url: 'ws://x/terminal',
      webSocketCtor: () => mock,
      onFrame: () => undefined,
      onState: (s) => states.push(s),
    });
    socket.connect();
    mock.triggerOpen();
    mock.close();
    expect(states).toContain('reconnecting');
    expect(socket.reconnectAttempts).toBe(1);
  });
});

describe('reconnectDelay (08 §3.1)', () => {
  it('指数退避 + jitter，封顶 30s', () => {
    expect(reconnectDelay(0, () => 1)).toBe(500);
    expect(reconnectDelay(1, () => 1)).toBe(1000);
    expect(reconnectDelay(100, () => 1)).toBe(30_000); // 封顶
    // jitter 落在 [0.5, 1.0] 区间
    expect(reconnectDelay(1, () => 0)).toBe(500);
  });
});
