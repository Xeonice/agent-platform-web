// 连接稳定性回归钉（P0）：回调身份抖动 + 多次状态变化下，socket 工厂只建一次、连接稳定 open。
// 该 bug 曾让终端反复自我拆除、永远稳不到 open（08 §7.4 / §3.1）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSandboxTerminalSocket } from '@/hooks/useSandboxTerminalSocket';
import { setErrorReporter } from '@/lib/_shared/reportError';
import type { SocketLike, SocketFactory, SocketFactoryArgs } from '@/services/ws/ptySocket';
import type { TerminalClientFrame } from '@/types/ws-protocol';

/** 可控 socket mock（依赖注入，避免 mock.module，12 §3.1.1）。 */
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

afterEach(() => {
  setErrorReporter(null);
  vi.restoreAllMocks();
});

function makeFactory(): {
  factory: SocketFactory;
  sockets: MockSocket[];
  calls: SocketFactoryArgs[];
} {
  const sockets: MockSocket[] = [];
  const calls: SocketFactoryArgs[] = [];
  const factory: SocketFactory = (args) => {
    calls.push(args);
    const s = new MockSocket();
    sockets.push(s);
    return s;
  };
  return { factory, sockets, calls };
}

const URI = 'http://x/terminal';
// 稳定 query 引用（真实来自 useTerminalSocketConfig 的 useMemo）。
const QUERY = { sandboxId: 's1', xSchemaHash: 'sb-terminal-v1' };

describe('useSandboxTerminalSocket 连接稳定性（P0 回归钉）', () => {
  it('回调身份抖动 + 多次重渲染：工厂只建一次连接、稳定 open 不自我拆除', () => {
    const { factory, sockets, calls } = makeFactory();

    const { result, rerender } = renderHook(
      // 每次渲染传入全新 onFrame（模拟父层 useCallback deps 抖动 → 引用变化）。
      ({ n }: { n: number }) =>
        useSandboxTerminalSocket({
          uri: URI,
          query: QUERY,
          socketFactory: factory,
          onFrame: () => void n,
        }),
      { initialProps: { n: 0 } },
    );

    // 首连：工厂建一次，状态 connecting。
    expect(calls).toHaveLength(1);
    expect(sockets).toHaveLength(1);

    // 服务端 connect → open。
    act(() => {
      sockets[0]!.triggerConnect();
    });
    expect(result.current.connState).toBe('open');

    // 多次重渲染（每次 onFrame 都是新引用）+ 交织若干次状态刷新。
    for (let i = 1; i <= 5; i++) {
      rerender({ n: i });
    }

    // 关键断言：工厂仍只被调用一次；连接未被拆除、稳定 open。
    expect(calls).toHaveLength(1);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.disconnected).toBe(false);
    expect(result.current.connState).toBe('open');
  });

  it('latest-ref：重渲染后收到帧时调用最新 onFrame', () => {
    const { factory, sockets } = makeFactory();
    const first = vi.fn();
    const second = vi.fn();

    const { result, rerender } = renderHook(
      ({ cb }: { cb: (f: unknown) => void }) =>
        useSandboxTerminalSocket({ uri: URI, query: QUERY, socketFactory: factory, onFrame: cb }),
      { initialProps: { cb: first as (f: unknown) => void } },
    );

    act(() => {
      sockets[0]!.triggerConnect();
    });
    rerender({ cb: second as (f: unknown) => void });

    act(() => {
      sockets[0]!.serverEmit({ type: 'data', data: 'hi' });
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ type: 'data', data: 'hi' });
    // 连接未因 onFrame 切换而重建。
    expect(sockets).toHaveLength(1);
    expect(result.current.connState).toBe('open');
  });

  it('非法帧接线：触发 onInvalidFrame 且不进 onFrame、不阻断（P1）', () => {
    const { factory, sockets } = makeFactory();
    const onFrame = vi.fn();
    const onInvalidFrame = vi.fn();

    renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame,
        onInvalidFrame,
      }),
    );

    act(() => {
      sockets[0]!.triggerConnect();
      sockets[0]!.serverEmit({ type: 'nope', foo: 1 });
    });

    expect(onFrame).not.toHaveBeenCalled();
    expect(onInvalidFrame).toHaveBeenCalledOnce();
    expect(onInvalidFrame).toHaveBeenCalledWith({ type: 'nope', foo: 1 });
  });

  it('非法帧内建经 reportError 落到单一上报点（P1-#4）', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reporter = vi.fn();
    setErrorReporter(reporter);
    const { factory, sockets } = makeFactory();

    renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame: vi.fn(),
      }),
    );

    act(() => {
      sockets[0]!.triggerConnect();
      sockets[0]!.serverEmit({ type: 'nope', foo: 1 });
    });

    expect(reporter).toHaveBeenCalledOnce();
    expect(reporter.mock.calls[0]?.[1]).toEqual({ raw: { type: 'nope', foo: 1 } });
  });

  it('WS 未授权（connect_error 含未授权文案）→ 透传 onUnauthorized（11 §3.1）', () => {
    const { factory, sockets } = makeFactory();
    const onUnauthorized = vi.fn();

    renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame: vi.fn(),
        onUnauthorized,
      }),
    );

    act(() => {
      sockets[0]!.triggerConnectError(new Error('unauthorized'));
    });

    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('P2：query 传新对象但内容浅相等 → 不重建连接（稳定性收回 hook 自身）', () => {
    const { factory, sockets, calls } = makeFactory();

    const { rerender } = renderHook(
      ({ q }: { q: Record<string, string> }) =>
        useSandboxTerminalSocket({ uri: URI, query: q, socketFactory: factory, onFrame: vi.fn() }),
      { initialProps: { q: { sandboxId: 's1', xSchemaHash: 'sb-terminal-v1' } } },
    );
    act(() => {
      sockets[0]!.triggerConnect();
    });
    expect(calls).toHaveLength(1);

    // 全新对象、等值内容（模拟调用方未 memo）：不应触发重连。
    rerender({ q: { sandboxId: 's1', xSchemaHash: 'sb-terminal-v1' } });
    expect(calls).toHaveLength(1);
    expect(sockets).toHaveLength(1);

    // 内容真正变化（换 sandbox）：应重建连接。
    rerender({ q: { sandboxId: 's2', xSchemaHash: 'sb-terminal-v1' } });
    expect(calls).toHaveLength(2);
  });
});

// ————————————————————————————————————————————————————————————————
// 退避耗尽 → 停手 → 「手动重连」（S6 收尾 ②，08 §11.6 的终点态）。
// 终端上的"停手"意味着用户正盯着的 shell 被判死：可以停，但必须把决定权交回用户。
// ————————————————————————————————————————————————————————————————
describe('useSandboxTerminalSocket · 退避耗尽与手动重连', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 一轮"连上即掉"。抖动型故障：老写法下退避会被 onConnect 清零、永远撞不到上限。 */
  function flap(socket: MockSocket | undefined): void {
    act(() => {
      socket?.triggerConnect();
    });
    act(() => {
      socket?.triggerDisconnect();
    });
  }

  it('抖动到上限 ⇒ 停止自动重连并进入 closed（不再无限重建 pty）', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame: vi.fn(),
        maxReconnect: 3,
      }),
    );

    for (let i = 0; i < 4; i += 1) {
      flap(sockets.at(-1));
      act(() => {
        vi.runOnlyPendingTimers();
      });
    }

    expect(result.current.connState).toBe('closed');
    const built = sockets.length;
    // 停手之后不再自己起新连接。
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(sockets).toHaveLength(built);
  });

  it('用户点「手动重连」⇒ 真的再建一条连接，且退避计数归零', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame: vi.fn(),
        maxReconnect: 2,
      }),
    );

    for (let i = 0; i < 3; i += 1) {
      flap(sockets.at(-1));
      act(() => {
        vi.runOnlyPendingTimers();
      });
    }
    expect(result.current.connState).toBe('closed');
    const built = sockets.length;

    act(() => {
      result.current.reconnect();
    });

    expect(sockets.length).toBe(built + 1);
    expect(result.current.connState).toBe('connecting');
    expect(result.current.attempt).toBe(0);
  });

  it('手动重连带回 socketSessionKey ⇒ 接回原来那个 shell 而不是开新 pty（08 §11.6）', () => {
    const { factory, sockets, calls } = makeFactory();
    const { result } = renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame: vi.fn(),
      }),
    );

    act(() => {
      sockets[0]!.triggerConnect();
      sockets[0]!.serverEmit({ type: 'session', socketSessionKey: 'KEY-9' });
    });

    act(() => {
      result.current.reconnect();
    });

    expect(calls[1]?.query['socketSessionKey']).toBe('KEY-9');
    expect(calls[1]?.query['sandboxId']).toBe('s1');
  });

  it('会话已终结时手动重连是 no-op（那条路走 [重启]，不是重连，08 §8 要点 1）', () => {
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame: vi.fn(),
        sessionEnded: true,
      }),
    );
    const built = sockets.length;

    act(() => {
      result.current.reconnect();
    });

    expect(sockets).toHaveLength(built);
  });
});

// ————————————————————————————————————————————————————————————————
// 握手被拒的**两类**：可自愈的未授权 vs 确定性的协议漂移（F3）。
//
// 以前 /terminal 只问 `isUnauthorizedError`，于是 SCHEMA_MISMATCH 被静默吞掉 ⇒
// 退避 8 次后停在「连接超时，已停止自动重连」加一个**永远按不通**的「手动重连」。
// 界面上说的每一句话都是错的：原因不是超时，出路也不是重连。
// ————————————————————————————————————————————————————————————————
describe('useSandboxTerminalSocket · 握手码分流（F3）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 后端 middleware 的形状：`next(err)` 前把码挂在 `err.data` 上，message 也以码开头。 */
  function handshakeError(code: string, message = `${code}: …`): Error {
    return Object.assign(new Error(message), { data: { code } });
  }

  it('SCHEMA_MISMATCH ⇒ 给出人话，且**不弹解锁门**（弹了也解不了）', () => {
    const onUnauthorized = vi.fn();
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame: vi.fn(),
        onUnauthorized,
      }),
    );

    act(() => {
      sockets[0]?.triggerConnectError(handshakeError('SCHEMA_MISMATCH'));
    });

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(result.current.handshakeErrorMessage).toMatch(/刷新页面/);
    // 文案里不许出现任何"解锁/口令"的字眼——那是另一类失败的出路。
    expect(result.current.handshakeErrorMessage ?? '').not.toMatch(/解锁|口令/);
  });

  it('SCHEMA_MISMATCH ⇒ **当场停手**，不再排期重连（重试是把同一次失败重复 N 遍）', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame: vi.fn(),
        maxReconnect: 8,
      }),
    );
    act(() => {
      sockets[0]?.triggerConnectError(handshakeError('SCHEMA_MISMATCH'));
    });
    const built = sockets.length;

    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    expect(sockets).toHaveLength(built);
  });

  it('SCHEMA_MISMATCH 下「手动重连」是 no-op（不给一个必定失败的动作）', () => {
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame: vi.fn(),
      }),
    );
    act(() => {
      sockets[0]?.triggerConnectError(handshakeError('SCHEMA_MISMATCH'));
    });
    const built = sockets.length;

    act(() => {
      result.current.reconnect();
    });

    expect(sockets).toHaveLength(built);
  });

  it('UNAUTHORIZED 是**另一类**：弹解锁门、不出协议漂移文案、退避照常继续', () => {
    vi.useFakeTimers();
    const onUnauthorized = vi.fn();
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame: vi.fn(),
        onUnauthorized,
        maxReconnect: 8,
      }),
    );

    act(() => {
      sockets[0]?.triggerConnectError(handshakeError('UNAUTHORIZED', 'UNAUTHORIZED: passcode'));
    });

    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(result.current.handshakeErrorMessage).toBeUndefined();

    // 可自愈 ⇒ 退避循环必须继续（解锁拿到 cookie 后下一次握手就过）。
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(sockets.length).toBeGreaterThan(1);
  });

  it('后端加的新码：如实透出码本身并**继续重连**（未知不等于致命）', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame: vi.fn(),
      }),
    );

    act(() => {
      sockets[0]?.triggerConnectError(handshakeError('TENANT_SUSPENDED'));
    });

    expect(result.current.handshakeErrorMessage).toContain('TENANT_SUSPENDED');
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(sockets.length).toBeGreaterThan(1);
  });

  it('传输层抖动（websocket error）不被当成握手被拒：不出文案、不停手', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame: vi.fn(),
      }),
    );

    act(() => {
      sockets[0]?.triggerConnectError(new Error('websocket error'));
    });

    expect(result.current.handshakeErrorMessage).toBeUndefined();
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(sockets.length).toBeGreaterThan(1);
  });

  it('后端修好后连上 ⇒ 文案消失（别把红条永远留在屏幕上）', () => {
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame: vi.fn(),
      }),
    );
    act(() => {
      sockets[0]?.triggerConnectError(handshakeError('SCHEMA_MISMATCH'));
    });
    expect(result.current.handshakeErrorMessage).toBeDefined();

    // 停手之后唯一的复活路径是重新挂载（刷新页面）——这里直接让当前 socket 连上，
    // 断言"连上即清"这条不变量成立。
    act(() => {
      sockets.at(-1)?.triggerConnect();
    });

    expect(result.current.handshakeErrorMessage).toBeUndefined();
  });
});

describe('会话结束 = 停止重连（本轮新增）', () => {
  // 真踩到的一次：用户刷新后终端"无限重连"。复现出来的服务端行为是
  //   connect → 1ms 后 disconnect，**一个帧都不发**
  // ——与网络抖动完全无法区分，于是前端只能按抖动重试：烧完 9 次退避约 2 分钟才停，
  // 而那个「手动重连」每按一次又把退避预算清零，再来一轮。
  //
  // 两半都得修：后端失败时**说一声**（发 `exit`），前端**听得见**（endedRef 接线）。
  // 这一组钉的是前端那半。
  it('⚠️ 未接 sessionEnded 时会一直重连 —— 这是修之前的行为，用它当对照', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame: () => undefined,
      }),
    );
    act(() => {
      sockets[0]!.triggerConnect();
      sockets[0]!.triggerDisconnect();
    });
    // 断开即安排了下一次重连（定时器在跑）——没有任何东西告诉它"别连了"。
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it('sessionEnded=true → 断开后不再安排重连（退避循环当场停）', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    renderHook(() =>
      useSandboxTerminalSocket({
        uri: URI,
        query: QUERY,
        socketFactory: factory,
        onFrame: () => undefined,
        sessionEnded: true,
      }),
    );
    act(() => {
      sockets[0]!.triggerConnect();
      sockets[0]!.triggerDisconnect();
    });
    // 判据是**没有排下一次**：不是"少连了几次"，而是这条循环彻底不再自我延续。
    expect(vi.getTimerCount()).toBe(0);
    expect(sockets[0]!.disconnected).toBe(true);
    // 而且不该有第二个 socket 被造出来。
    expect(sockets).toHaveLength(1);
    vi.useRealTimers();
  });
});
