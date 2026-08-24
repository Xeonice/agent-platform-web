// /events 订阅 hook 补测：帧解析→store 更新、非法帧→reportError、未授权→回调。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSandboxEventsSocket } from '@/hooks/sandbox/useSandboxEventsSocket';
import { setErrorReporter } from '@/lib/_shared/reportError';
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
  useAppStore.getState().clearCloneProgress('p1');
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

  it('project.clone_progress → 路由到项目 clone store（同一 /events 通道分发）', () => {
    const { factory, sockets } = makeFactory();
    renderHook(() =>
      useSandboxEventsSocket({ base: 'ws://localhost:3001', socketFactory: factory }),
    );

    act(() => {
      sockets[0]!.triggerConnect();
      sockets[0]!.serverEmit({
        event: 'project.clone_progress',
        projectId: 'p1',
        phase: 'cloning',
        percent: 40,
      });
    });

    expect(useAppStore.getState().projectClones['p1']).toMatchObject({
      phase: 'cloning',
      percent: 40,
    });
    // sandbox 状态表不受影响
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

  it('SCHEMA_MISMATCH → 不弹解锁门、经 reportError 说出来、并把码透出（本通道无 UI，但不许静默）', () => {
    const { factory, sockets } = makeFactory();
    const onUnauthorized = vi.fn();
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const { result } = renderHook(() =>
      useSandboxEventsSocket({
        base: 'ws://localhost:3001',
        socketFactory: factory,
        onUnauthorized,
      }),
    );

    act(() => {
      sockets[0]!.triggerConnectError(
        Object.assign(new Error('SCHEMA_MISMATCH: …'), { data: { code: 'SCHEMA_MISMATCH' } }),
      );
    });

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(result.current.handshakeErrorCode).toBe('SCHEMA_MISMATCH');
    expect(reporter).toHaveBeenCalledWith(
      expect.stringContaining('握手被拒'),
      expect.objectContaining({ code: 'SCHEMA_MISMATCH' }),
    );
  });

  it('⚠️ 协议漂移下 /events **仍然不停手**（本通道刻意与另外两条不同，理由见 hook 头注释）', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    renderHook(() =>
      useSandboxEventsSocket({ base: 'ws://localhost:3001', socketFactory: factory }),
    );

    act(() => {
      sockets[0]!.triggerConnectError(
        Object.assign(new Error('SCHEMA_MISMATCH: …'), { data: { code: 'SCHEMA_MISMATCH' } }),
      );
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });

    // 停手会让整个工作台的实时投影永久死掉，代价远大于每 30s 敲一次门。
    expect(sockets.length).toBeGreaterThan(1);
    vi.useRealTimers();
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

// ————————————————————————————————————————————————————————————————
// 重连策略（S6 收尾 ②）：/events 与另外两个通道**刻意不同** —— 它不停手。
// 理由见 useSandboxEventsSocket.ts 头注释；这里只钉住可观察行为。
// ————————————————————————————————————————————————————————————————
describe('useSandboxEventsSocket · 重连策略', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('⚠️ 远超另外两条通道的 8 次上限仍继续重连：投影通道停手 = 整个工作台静默冻住', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    renderHook(() =>
      useSandboxEventsSocket({ base: 'ws://localhost:3001', socketFactory: factory }),
    );

    for (let i = 0; i < 20; i += 1) {
      act(() => {
        sockets.at(-1)?.triggerConnectError(new Error('websocket error'));
      });
      act(() => {
        vi.runOnlyPendingTimers();
      });
    }

    // 每一轮都真的又建了一条：21 = 首连 + 20 次重连。
    expect(sockets).toHaveLength(21);
  });

  it('退避真的增长并封顶：第 20 次重连的等待已经是 30s 上限，不是几百毫秒的忙循环', () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { factory, sockets } = makeFactory();
    renderHook(() =>
      useSandboxEventsSocket({ base: 'ws://localhost:3001', socketFactory: factory }),
    );

    const delays: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      setTimeoutSpy.mockClear();
      act(() => {
        sockets.at(-1)?.triggerConnectError(new Error('websocket error'));
      });
      const call = setTimeoutSpy.mock.calls.at(-1);
      delays.push(typeof call?.[1] === 'number' ? call[1] : 0);
      act(() => {
        vi.runOnlyPendingTimers();
      });
    }

    // 首次重连 attempt=1 ⇒ 500~1000ms（jitter 0.5~1.0）；末次已在 15000~30000ms（封顶 30s 的 jitter 区间）。
    expect(delays[0]).toBeLessThanOrEqual(1_000);
    expect(delays.at(-1)).toBeGreaterThanOrEqual(15_000);
    expect(delays.at(-1)).toBeLessThanOrEqual(30_000);
  });

  it('**连上即掉**同样让退避增长（不被 onConnect 清零）', () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useSandboxEventsSocket({ base: 'ws://localhost:3001', socketFactory: factory }),
    );

    for (let i = 0; i < 6; i += 1) {
      act(() => {
        sockets.at(-1)?.triggerConnect();
      });
      act(() => {
        sockets.at(-1)?.triggerDisconnect();
      });
      act(() => {
        vi.runOnlyPendingTimers();
      });
    }

    // 老写法（onConnect 里清零）下 attempt 恒为 1、delay 恒为几百毫秒。
    expect(result.current.attempt).toBe(6);
    const last = setTimeoutSpy.mock.calls.at(-1)?.[1];
    expect(typeof last === 'number' ? last : 0).toBeGreaterThan(1_000);
  });

  it('卸载仍然彻底收手（"不停手"是对故障说的，不是对卸载说的）', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    const { unmount } = renderHook(() =>
      useSandboxEventsSocket({ base: 'ws://localhost:3001', socketFactory: factory }),
    );

    act(() => {
      sockets[0]?.triggerConnectError(new Error('websocket error'));
    });
    unmount();
    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.disconnected).toBe(true);
  });
});
