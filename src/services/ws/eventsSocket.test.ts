import { describe, it, expect, vi } from 'vitest';
import { EventsSocket, type EventsSocketLike } from '@/services/ws/eventsSocket';
import type { SandboxEvent } from '@/types/ws-protocol';

/** 可控 /events socket mock（依赖注入替代 mock.module，12 §3.1.1）。 */
class MockEventsSocket implements EventsSocketLike {
  private connectCb: (() => void) | null = null;
  private disconnectCb: (() => void) | null = null;
  private connectErrorCb: ((err?: unknown) => void) | null = null;
  private eventCb: ((raw: unknown) => void) | null = null;
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
  onEvent(cb: (raw: unknown) => void): void {
    this.eventCb = cb;
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
    this.eventCb?.(raw);
  }
}

describe('EventsSocket (/events 通道 10 §7.4)', () => {
  it('合法 SandboxEvent 经 zod 后投递 onEvent', () => {
    const mock = new MockEventsSocket();
    const events: SandboxEvent[] = [];
    const socket = new EventsSocket({
      uri: 'http://x/events',
      socketFactory: () => mock,
      onEvent: (e) => events.push(e),
      onState: () => undefined,
    });
    socket.connect();
    mock.triggerConnect();
    mock.serverEmit({ event: 'sandbox.status_changed', sandboxId: 's1', status: 'running' });
    expect(events).toEqual([
      { event: 'sandbox.status_changed', sandboxId: 's1', status: 'running' },
    ]);
  });

  it('非法帧不进下游、触发 onInvalidFrame（zod 兜底）', () => {
    const mock = new MockEventsSocket();
    const onEvent = vi.fn();
    const onInvalidFrame = vi.fn();
    const socket = new EventsSocket({
      uri: 'http://x/events',
      socketFactory: () => mock,
      onEvent,
      onInvalidFrame,
      onState: () => undefined,
    });
    socket.connect();
    mock.triggerConnect();
    mock.serverEmit({ event: 'nope', foo: 1 });
    expect(onEvent).not.toHaveBeenCalled();
    expect(onInvalidFrame).toHaveBeenCalledOnce();
  });

  it('connect_error 含未授权文案 → onUnauthorized（口令门 11 §3.1）', () => {
    const mock = new MockEventsSocket();
    const onUnauthorized = vi.fn();
    const socket = new EventsSocket({
      uri: 'http://x/events',
      socketFactory: () => mock,
      onEvent: () => undefined,
      onState: () => undefined,
      onUnauthorized,
    });
    socket.connect();
    mock.triggerConnectError(new Error('unauthorized'));
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(socket.connState).toBe('reconnecting');
  });

  it('普通传输错误不误判为未授权', () => {
    const mock = new MockEventsSocket();
    const onUnauthorized = vi.fn();
    const socket = new EventsSocket({
      uri: 'http://x/events',
      socketFactory: () => mock,
      onEvent: () => undefined,
      onState: () => undefined,
      onUnauthorized,
    });
    socket.connect();
    mock.triggerConnectError(new Error('websocket error'));
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('disconnect → reconnecting 状态并计数', () => {
    const mock = new MockEventsSocket();
    const states: string[] = [];
    const socket = new EventsSocket({
      uri: 'http://x/events',
      socketFactory: () => mock,
      onEvent: () => undefined,
      onState: (s) => states.push(s),
    });
    socket.connect();
    mock.triggerConnect();
    mock.triggerDisconnect();
    expect(states).toContain('reconnecting');
    expect(socket.reconnectAttempts).toBe(1);
  });

  it('close 后主动断开且不再 reconnecting', () => {
    const mock = new MockEventsSocket();
    const states: string[] = [];
    const socket = new EventsSocket({
      uri: 'http://x/events',
      socketFactory: () => mock,
      onEvent: () => undefined,
      onState: (s) => states.push(s),
    });
    socket.connect();
    mock.triggerConnect();
    socket.close();
    expect(mock.disconnected).toBe(true);
    mock.triggerDisconnect(); // 用户已 close，不应再进 reconnecting
    expect(states.filter((s) => s === 'reconnecting')).toHaveLength(0);
  });
});
