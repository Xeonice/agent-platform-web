// 连接稳定性回归钉（P0）：回调身份抖动 + 多次状态变化下，socket 工厂只建一次、连接稳定 open。
// 该 bug 曾让终端反复自我拆除、永远稳不到 open（08 §7.4 / §3.1）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSandboxTerminalSocket } from '@/hooks/useSandboxTerminalSocket';
import { setErrorReporter } from '@/lib/reportError';
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
