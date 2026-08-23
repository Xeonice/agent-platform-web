import { describe, it, expect, vi, afterEach } from 'vitest';
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

// ————————————————————————————————————————————————————————————————
// 抖动型重连（S6 收尾 ②）：三个通道共用的 STABLE_CONNECTION_MS 纪律。
// /events 是全局单连接，"连上即掉"时若退避恒定在几百毫秒，就是每秒往后端装配一次订阅。
// ————————————————————————————————————————————————————————————————
describe('EventsSocket · 抖动型重连', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeFlapping(): {
    socket: EventsSocket;
    flap: () => void;
    mock: () => MockEventsSocket;
  } {
    let current = new MockEventsSocket();
    const socket = new EventsSocket({
      uri: 'http://x/events',
      socketFactory: () => {
        current = new MockEventsSocket();
        return current;
      },
      onEvent: () => undefined,
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

    // 老写法恒为 1 ⇒ 退避永远是几百毫秒。
    expect(socket.reconnectAttempts).toBe(3);
  });

  it('**站得住**的连接掉线 ⇒ 退避清零（正常网络抖动不被当成故障累加）', () => {
    vi.useFakeTimers();
    const { socket, flap, mock } = makeFlapping();

    flap();
    flap();
    expect(socket.reconnectAttempts).toBe(2);

    mock().triggerConnect();
    vi.advanceTimersByTime(30_000);
    mock().triggerDisconnect();

    expect(socket.reconnectAttempts).toBe(1);
  });
});
