// /events 订阅 hook 补测：帧解析→store 更新、非法帧→reportError、未授权→回调。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSandboxEventsSocket } from '@/hooks/useSandboxEventsSocket';
import { setErrorReporter } from '@/lib/reportError';
import { useAppStore } from '@/stores';
import type { EventsSocketLike, EventsSocketFactory } from '@/services/ws/eventsSocket';

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
  triggerConnectError(err?: unknown): void {
    this.connectErrorCb?.(err);
  }
  serverEmit(raw: unknown): void {
    this.eventCb?.(raw);
  }
}

function makeFactory(): { factory: EventsSocketFactory; sockets: MockEventsSocket[] } {
  const sockets: MockEventsSocket[] = [];
  const factory: EventsSocketFactory = () => {
    const s = new MockEventsSocket();
    sockets.push(s);
    return s;
  };
  return { factory, sockets };
}

beforeEach(() => {
  useAppStore.getState().clearSandboxStatus('s1');
});
afterEach(() => {
  setErrorReporter(null);
  vi.restoreAllMocks();
});

describe('useSandboxEventsSocket', () => {
  it('合法 status_changed → 写入 sandbox 状态 store', () => {
    const { factory, sockets } = makeFactory();
    renderHook(() =>
      useSandboxEventsSocket({ base: 'ws://localhost:3001', socketFactory: factory }),
    );

    act(() => {
      sockets[0]!.triggerConnect();
      sockets[0]!.serverEmit({
        event: 'sandbox.status_changed',
        sandboxId: 's1',
        status: 'running',
      });
    });

    expect(useAppStore.getState().sandboxStatuses['s1']?.status).toBe('running');
  });

  it('非法帧 → reportError（单一上报点），不写 store', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const { factory, sockets } = makeFactory();
    renderHook(() =>
      useSandboxEventsSocket({ base: 'ws://localhost:3001', socketFactory: factory }),
    );

    act(() => {
      sockets[0]!.triggerConnect();
      sockets[0]!.serverEmit({ event: 'nope', foo: 1 });
    });

    expect(reporter).toHaveBeenCalledOnce();
    expect(useAppStore.getState().sandboxStatuses['s1']).toBeUndefined();
  });

  it('未授权 connect_error → 透传 onUnauthorized', () => {
    const { factory, sockets } = makeFactory();
    const onUnauthorized = vi.fn();
    renderHook(() =>
      useSandboxEventsSocket({
        base: 'ws://localhost:3001',
        socketFactory: factory,
        onUnauthorized,
      }),
    );

    act(() => {
      sockets[0]!.triggerConnectError(new Error('unauthorized'));
    });

    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('enabled:false → 不建立连接', () => {
    const { factory, sockets } = makeFactory();
    renderHook(() =>
      useSandboxEventsSocket({
        base: 'ws://localhost:3001',
        socketFactory: factory,
        enabled: false,
      }),
    );
    expect(sockets).toHaveLength(0);
  });
});
