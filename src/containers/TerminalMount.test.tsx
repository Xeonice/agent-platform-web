// TerminalMount 的"胶水"回归（review 指出此前零覆盖）。
//
// 这次改动里风险最高的恰恰是胶水本身——effect 依赖数组、prop 优先级、状态接管顺序
// ——而不是被测过的 `resync()` / `sessionEnded` 单点逻辑。下面按真实时序钉住它们。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import type { TerminalServerFrame } from '@/types/ws-protocol';
import { WS_SCHEMA_HASH } from '@/lib/terminal/terminalSocket';
import { TERMINAL_EXIT_ATTACH_FAILED, type TerminalSocketConfig } from '@/types/terminal';

const term = vi.hoisted(() => ({
  attach: vi.fn(() => Promise.resolve()),
  write: vi.fn(),
  fit: vi.fn(),
  resync: vi.fn(),
  dispose: vi.fn(),
  getRenderer: vi.fn(),
  lastArgs: null as {
    onInput?: (d: string) => void;
    onResize?: (c: number, r: number) => void;
  } | null,
}));
// ⚠️ 返回**稳定引用**，与真实的 `useTerminalInstance` 一致（它用 useMemo 固定身份，
// 注释里写明"否则下游 useCallback 身份抖动 → 连接 effect 反复 close+重连"）。
// 第一版这个替身每次渲染返回新对象字面量，于是 `resync` 的 effect 每渲染都重跑一次
// ——测试报 2 次，而生产代码只会 1 次。**替身比真实情况松，测出来的是替身的毛病。**
const termApi = {
  attach: (args: { onInput?: (d: string) => void; onResize?: (c: number, r: number) => void }) => {
    term.lastArgs = args;
    return term.attach();
  },
  write: term.write,
  fit: term.fit,
  resync: term.resync,
  dispose: term.dispose,
  getRenderer: term.getRenderer,
};
vi.mock('@/hooks/useTerminalInstance', () => ({
  useTerminalInstance: () => termApi,
}));

const sock = vi.hoisted(() => ({
  connState: 'connecting',
  sessionEnded: undefined as boolean | undefined,
  onFrame: null as ((f: TerminalServerFrame) => void) | null,
  send: vi.fn(() => true),
  // 建连时序的两个观察点：是否放行、以及放行那一刻 query 里的尺寸。
  enabled: undefined as boolean | undefined,
  query: null as Record<string, string> | null,
}));
vi.mock('@/hooks/useSandboxTerminalSocket', () => ({
  useSandboxTerminalSocket: (args: {
    onFrame: (f: TerminalServerFrame) => void;
    sessionEnded?: boolean;
    enabled?: boolean;
    query?: Record<string, string>;
  }) => {
    sock.onFrame = args.onFrame;
    sock.sessionEnded = args.sessionEnded;
    sock.enabled = args.enabled;
    sock.query = args.query ?? null;
    return {
      connState: sock.connState,
      attempt: 0,
      send: sock.send,
      reconnect: () => undefined,
      handshakeErrorMessage: undefined,
    };
  },
}));
vi.mock('@/hooks/useAccessGate', () => ({
  useReportUnauthorized: () => ({ reportUnauthorized: () => undefined }),
}));

import TerminalMount from '@/containers/TerminalMount';

// jsdom 没有 ResizeObserver。桩留一个句柄，顺带让"清理时 disconnect 了没有"可断言。
const roInstances: { observed: number; disconnected: boolean }[] = [];
class StubResizeObserver implements ResizeObserver {
  private readonly self = { observed: 0, disconnected: false };
  constructor(cb: ResizeObserverCallback) {
    void cb; // 桩不回调；本组用例只关心 observe/disconnect 生命周期
    roInstances.push(this.self);
  }
  observe(): void {
    this.self.observed += 1;
  }
  unobserve(): void {
    /* 本组用例不用 */
  }
  disconnect(): void {
    this.self.disconnected = true;
  }
}
globalThis.ResizeObserver = StubResizeObserver;

const CFG: TerminalSocketConfig = {
  uri: 'http://x/terminal',
  query: { sandboxId: 's1', cols: '80', rows: '24', xSchemaHash: WS_SCHEMA_HASH },
};

function mount() {
  return render(<TerminalMount sessionId="s1" sandboxId="s1" socketConfig={CFG} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  sock.connState = 'connecting';
  sock.sessionEnded = undefined;
  term.lastArgs = null;
});

describe('TerminalMount · 尺寸与会话终止的接线', () => {
  it('onResize 真的发出 resize 帧（此前是 () => undefined，PTY 永远停在 80x24）', () => {
    mount();
    act(() => {
      term.lastArgs?.onResize?.(120, 40);
    });
    expect(sock.send).toHaveBeenCalledWith({ type: 'resize', cols: 120, rows: 40 });
  });

  it('socket 变 open 才 resync —— connecting 阶段不该发', () => {
    const { rerender } = mount();
    expect(term.resync).not.toHaveBeenCalled();

    sock.connState = 'open';
    rerender(<TerminalMount sessionId="s1" sandboxId="s1" socketConfig={CFG} />);
    expect(term.resync).toHaveBeenCalledTimes(1);

    // ⚠️ 同一次 open 内重渲不得重复发：resync 会清掉去重记录，重复调用等于每次
    // 重渲都往 PTY 打一帧 resize。
    rerender(<TerminalMount sessionId="s1" sandboxId="s1" socketConfig={CFG} />);
    expect(term.resync).toHaveBeenCalledTimes(1);
  });

  it('收到 exit 帧 → sessionEnded 传下去（此前从来没传过，退避循环永不停）', () => {
    mount();
    expect(sock.sessionEnded).toBe(false);
    act(() => {
      sock.onFrame?.({ type: 'exit', code: 0 });
    });
    expect(sock.sessionEnded).toBe(true);
  });

  it('⚠️ -2 与 -1 的文案必须不同 —— 一个是"没连上"，一个是"进程被信号杀死"', () => {
    mount();
    act(() => {
      sock.onFrame?.({ type: 'exit', code: TERMINAL_EXIT_ATTACH_FAILED });
    });
    const attach = screen.getByTestId('terminal-session-ended').textContent;
    expect(attach).toContain('没能连上');
    expect(attach).toContain('重新发起任务');

    // ⚠️ 只断言 -2 是不够的：把两个码合并成一句话时，-2 那条照样通过。
    // 必须同时钉住 **-1 说的是另一回事** —— 被 OOM kill 的 agent 跑过、可能有日志，
    // 告诉他"实例可能已不存在"是假话，出路也不该是"重新发起任务"。
    cleanup();
    mount();
    act(() => {
      sock.onFrame?.({ type: 'exit', code: -1 });
    });
    const signal = screen.getByTestId('terminal-session-ended').textContent;
    expect(signal).toContain('信号');
    expect(signal).not.toContain('没能连上');
    expect(signal).not.toContain('重新发起任务');
  });

  it('ResizeObserver 挂了也收 —— 卸载时必须 disconnect（否则每次重挂泄漏一个观察者）', () => {
    const before = roInstances.length;
    const { unmount } = mount();
    expect(roInstances.length).toBe(before + 1);
    expect(roInstances[before]?.observed).toBe(1);
    unmount();
    expect(roInstances[before]?.disconnected).toBe(true);
  });

  it('会话结束的状态条接管整条，且**不给**按不通的手动重连', () => {
    mount();
    act(() => {
      sock.onFrame?.({ type: 'exit', code: -1 });
    });
    expect(screen.getByTestId('terminal-session-ended')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /手动重连/ })).not.toBeInTheDocument();
  });
});

describe('TerminalMount · 先 fit 再建连（PTY 出生尺寸）', () => {
  /**
   * PTY 的出生尺寸由建连 query 的 `cols/rows` 决定，而 agent CLI 一启动就按它画欢迎
   * 横幅。终端协议没有"回流"——已吐出的字节不会因为后来的 resize 重排，所以
   * "先按 80x24 连上、事后补一帧 resize"**救不回第一屏**：宽屏上就是一个 80 列的窄框
   * 浮在一大片空白里。
   *
   * MUTATION ①：`enabled: fittedSize !== null` 改成 `enabled: true` → 第一条红。
   * MUTATION ②：query 不并入 fittedSize（直接用 socketConfig.query）→ 第二条红。
   */
  it('fit 之前不建连', () => {
    mount();
    // attach 已发生，但 onResize 还没回调 ⇒ 尺寸未知 ⇒ 不放行。
    expect(sock.enabled).toBe(false);
  });

  it('fit 之后放行，且 query 带的是真实尺寸（不是 80x24）', () => {
    mount();
    act(() => {
      term.lastArgs?.onResize?.(213, 51);
    });
    expect(sock.enabled).toBe(true);
    expect(sock.query?.['cols']).toBe('213');
    expect(sock.query?.['rows']).toBe('51');
  });

  /**
   * ★ 尺寸变化**不得**改动建连 query —— 否则连接 effect 会 close + 重连，而连接态一变
   * `ConnectionStatus` 就多渲染一条横条、把终端高度再改一次 ⇒ 自喂循环。
   * 出生尺寸对就够了（L-7），之后的变化走 resize 帧。
   *
   * MUTATION：`setFittedSize((prev) => prev ?? {cols,rows})` 改回"每次都更新" → 本条红。
   */
  it('后续 resize 不改建连 query（只发 resize 帧，不重连）', () => {
    mount();
    act(() => {
      term.lastArgs?.onResize?.(213, 51);
    });
    const first = sock.query;
    expect(first?.['cols']).toBe('213');

    act(() => {
      term.lastArgs?.onResize?.(80, 20); // 窗口被拖小
    });
    // query 必须原样：cols 仍是首次那个值。
    expect(sock.query?.['cols']).toBe('213');
    expect(sock.query?.['rows']).toBe('51');
    // 而 resize 帧照发（PTY 靠它跟上真实尺寸）。
    expect(sock.send).toHaveBeenCalledWith({ type: 'resize', cols: 80, rows: 20 });
  });
});
