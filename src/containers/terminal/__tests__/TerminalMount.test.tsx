// TerminalMount 的"胶水"回归（review 指出此前零覆盖）。
//
// 这次改动里风险最高的恰恰是胶水本身——effect 依赖数组、prop 优先级、状态接管顺序
// ——而不是被测过的 `resync()` / `sessionEnded` 单点逻辑。下面按真实时序钉住它们。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type {
  TerminalClientFrame,
  TerminalServerFrame,
  TerminalShellSummary,
} from '@/types/ws-protocol';
import { WS_SCHEMA_HASH } from '@/lib/terminal/terminalSocket';
import { TERMINAL_EXIT_ATTACH_FAILED, type TerminalSocketConfig } from '@/types/terminal';
import { useAppStore } from '@/stores';

const sonnerToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: sonnerToast }));

const term = vi.hoisted(() => ({
  attach: vi.fn(() => Promise.resolve()),
  write: vi.fn(),
  fit: vi.fn(),
  resync: vi.fn(),
  dispose: vi.fn(),
  getRenderer: vi.fn(),
  // 工具栏三个新方法（design-notes.md §4 Phase 3）：本文件测的是装配时序，
  // 不重复测这几个方法本身的行为（那在 useTerminalInstance.test.tsx 里）。
  clear: vi.fn(),
  getSelectionText: vi.fn(() => ''),
  setFontSize: vi.fn(),
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
  clear: term.clear,
  getSelectionText: term.getSelectionText,
  setFontSize: term.setFontSize,
};
vi.mock('@/hooks/terminal/useTerminalInstance', () => ({
  useTerminalInstance: () => termApi,
  // 三个常量本轮改用重导出（`@/lib/terminal/terminalTheme` 的唯一实现点，
  // containers 层按 boundaries 规则不许直接 import lib，见该文件头注释）。
  DEFAULT_TERMINAL_FONT_SIZE: 14,
  MIN_TERMINAL_FONT_SIZE: 10,
  MAX_TERMINAL_FONT_SIZE: 22,
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
vi.mock('@/hooks/terminal/useSandboxTerminalSocket', () => ({
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
vi.mock('@/hooks/access/useAccessGate', () => ({
  useReportUnauthorized: () => ({ reportUnauthorized: () => undefined }),
}));

import TerminalMount from '@/containers/terminal/TerminalMount';

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
  // 字号本轮改接 `uiSlice.terminalFontSize`（真实、跨用例持续存在的全局 store，
  // 07 §4 的分层规则允许 container 用它）——不重置的话，前一条用例点过 [A+]/[A-]
  // 留下的字号会带进下一条，"从默认值开始点 N 次"这类断言会因为起点不对而误报。
  useAppStore.getState().setTerminalFontSize(14);
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
    expect(attach).toContain('重新发起一个任务');

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
    expect(signal).not.toContain('重新发起一个任务');
  });

  /**
   * ⭐ **`-2` 不许往终端里写「[进程已退出，code -2]」**（2026-09-11 修）。
   *
   * `-2`（`TERMINAL_EXIT_ATTACH_FAILED`）是**平台自造的哨兵码，不是任何进程的退出码**
   * —— 这一支上根本没有"进程退出"这回事（平台压根没附着上）。把它印成
   * 「进程已退出，code -2」是在终端里写一句假话，而且是用户最可能截图去搜的那一句。
   * 上面那条用例证明了 -2 / -1 的**状态条**不同，但屏幕上这一行此前仍把两支写成一样。
   *
   * MUTATION: 把 `if (!attachFailed)` 去掉（无条件 `term.write`）⇒ 第一条断言红。
   */
  it('⭐ -2 是平台哨兵码，不是退出码 ⇒ 终端里**不写**那一行，只走状态条', () => {
    mount();
    act(() => {
      sock.onFrame?.({ type: 'exit', code: TERMINAL_EXIT_ATTACH_FAILED });
    });
    // 屏上一个字都不写：那一行会说一件没发生过的事。
    expect(term.write).not.toHaveBeenCalledWith('s1', expect.stringContaining('进程已退出'));
    // 但话没有少说 —— 状态条把"没连上、重连没用"讲清楚了。
    expect(screen.getByTestId('terminal-session-ended').textContent).toContain('没能连上');

    // 反面：-1 与真实退出码确实有进程退出过，那一行照旧写。
    cleanup();
    mount();
    act(() => {
      sock.onFrame?.({ type: 'exit', code: 137 });
    });
    expect(term.write).toHaveBeenCalledWith(
      's1',
      expect.stringContaining('[进程已退出，code 137]'),
    );
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

/**
 * 多标签给 TerminalMount 加的三条接线（06 §5 / 08 §5）。每一条漏掉都不会报错，
 * 只会让界面悄悄变坏 —— 所以三条都钉住。
 */
describe('TerminalMount · 多标签接线', () => {
  it('⭐ `session` 首帧带 shellId ⇒ 往上报（这个标签靠它在重建时接回同一个会话）', () => {
    const onShellId = vi.fn();
    render(
      <TerminalMount sessionId="s1" sandboxId="s1" socketConfig={CFG} onShellId={onShellId} />,
    );
    act(() => {
      sock.onFrame?.({ type: 'session', socketSessionKey: 'K', shellId: 'a'.repeat(32) });
    });
    expect(onShellId).toHaveBeenCalledWith('a'.repeat(32));
  });

  it('⚠️ agent 连接的首帧不带 shellId ⇒ **不往上报**（缺席 ≠ 空串）', () => {
    const onShellId = vi.fn();
    render(
      <TerminalMount sessionId="s1" sandboxId="s1" socketConfig={CFG} onShellId={onShellId} />,
    );
    act(() => {
      sock.onFrame?.({ type: 'session', socketSessionKey: 'K' });
    });
    // 报一个空串会让上层把 agent 标签当成"有会话 id 的 shell 标签"。
    expect(onShellId).not.toHaveBeenCalled();
  });

  it('⭐ 从后台切回前台 ⇒ 补一次 fit（隐藏期间宽度是 0，doFit 按纪律跳过）', () => {
    const { rerender } = render(
      <TerminalMount sessionId="s1" sandboxId="s1" socketConfig={CFG} active={false} />,
    );
    const before = term.fit.mock.calls.length;

    rerender(<TerminalMount sessionId="s1" sandboxId="s1" socketConfig={CFG} active />);

    // 不补的话 xterm 停在隐藏前的行列数，而 tmux 用绝对定位画状态栏 ——
    // 屏幕上就是一串错位的重复状态栏（本域已经为尺寸不同步栽过一次）。
    expect(term.fit.mock.calls.length).toBeGreaterThan(before);
  });

  it('registerSend 交出一个能发帧的转发器，卸载时注销（装配层据它代发 close_shell）', () => {
    const registered: (((f: TerminalClientFrame) => boolean) | null)[] = [];
    const { unmount } = render(
      <TerminalMount
        sessionId="s1"
        sandboxId="s1"
        socketConfig={CFG}
        registerSend={(send) => registered.push(send)}
      />,
    );
    expect(registered).toHaveLength(1);
    registered[0]?.({ type: 'close_shell', shellId: 'a'.repeat(32) });
    expect(sock.send).toHaveBeenCalledWith({ type: 'close_shell', shellId: 'a'.repeat(32) });

    unmount();
    // ⛔ 不注销的话，被淘汰的标签会在装配层留下一个僵尸 sender，
    //    "借一条连接代发"就会借到一条已经断了的连接。
    expect(registered.at(-1)).toBeNull();
  });
});

describe('TerminalMount · 后端清单帧（06 §5.5）', () => {
  it('⭐ `shells` 帧原样往上传，`null` **不许**在这一层折成 `[]`', () => {
    const onShells = vi.fn<(shells: TerminalShellSummary[] | null) => void>();
    render(<TerminalMount sessionId="s1" sandboxId="s1" socketConfig={CFG} onShells={onShells} />);

    act(() => {
      sock.onFrame?.({ type: 'shells', shells: [{ shellId: 'a'.repeat(32) }] });
    });
    act(() => {
      sock.onFrame?.({ type: 'shells', shells: [] });
    });
    act(() => {
      sock.onFrame?.({ type: 'shells', shells: null });
    });

    // 三态一路保到上层：折一下就是把「问不出来」说成「没有」。
    const seen: (TerminalShellSummary[] | null)[] = onShells.mock.calls.map(([arg]) => arg);
    expect(seen).toEqual([[{ shellId: 'a'.repeat(32) }], [], null]);
  });

  it('⚠️ `shells` 帧不写屏、不影响会话终止判定（它不是终端输出）', () => {
    render(<TerminalMount sessionId="s1" sandboxId="s1" socketConfig={CFG} />);
    const before = term.write.mock.calls.length;
    act(() => {
      sock.onFrame?.({ type: 'shells', shells: null });
    });
    expect(term.write.mock.calls.length).toBe(before);
    expect(sock.sessionEnded).toBe(false);
  });
});

// ————————————————————————————————————————————————————————————————
// 终端仪表壳工具栏（design-notes.md §4 Phase 3）：面包屑 + 复制/清屏/字号。
// ⚠️ 硬要求自查：这里钉的是**接线**（点按钮 → 调用了哪个 `term.*` 方法、传了什么参数），
// 方法本身的行为已经在 `useTerminalInstance.test.tsx` 用真实 xterm 实例测过。
// ————————————————————————————————————————————————————————————————
describe('TerminalMount · 终端工具栏接线', () => {
  beforeEach(() => {
    sonnerToast.success.mockClear();
    sonnerToast.error.mockClear();
    term.clear.mockClear();
    term.getSelectionText.mockClear();
    term.setFontSize.mockClear();
  });

  /**
   * ⭐ 没传 `breadcrumb` ⇒ 工具栏整个不渲染——纯终端场景没有项目/任务上下文可拼。
   * 变异：把渲染条件从 `breadcrumb === undefined` 改成恒渲染 ⇒ 本例会在没有
   * breadcrumb 时也找到 `terminal-toolbar`。
   */
  it('未传 breadcrumb ⇒ 不渲染工具栏', () => {
    render(<TerminalMount sessionId="s1" sandboxId="s1" socketConfig={CFG} />);
    expect(screen.queryByTestId('terminal-toolbar')).not.toBeInTheDocument();
  });

  it('传了 breadcrumb ⇒ 工具栏渲染，面包屑原样显示', () => {
    render(
      <TerminalMount
        sessionId="s1"
        sandboxId="s1"
        socketConfig={CFG}
        breadcrumb="ProjectA / Codex · 重构支付模块的类型定义"
      />,
    );
    expect(screen.getByTestId('terminal-toolbar-breadcrumb')).toHaveTextContent(
      'ProjectA / Codex · 重构支付模块的类型定义',
    );
  });

  /**
   * ⭐ [复制] 有内容 ⇒ 真的写剪贴板并提示成功。
   * 变异：把 `handleCopy` 里 `term.getSelectionText(sessionId)` 的 `sessionId` 传成
   * 别的字符串（比如写死 's0'）⇒ 多会话场景下会复制到错误标签的内容——本例虽是
   * 单会话测不出串号，但下面这句直接钉参数值。
   */
  it('[复制] 有内容 ⇒ 写剪贴板并提示成功，且传的是这个挂载点自己的 sessionId', async () => {
    term.getSelectionText.mockReturnValue('HELLO');
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <TerminalMount sessionId="s-copy" sandboxId="sbx" socketConfig={CFG} breadcrumb="A / B" />,
    );
    fireEvent.click(screen.getByTestId('terminal-toolbar-copy'));

    expect(term.getSelectionText).toHaveBeenCalledWith('s-copy');
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('HELLO');
    });
    await waitFor(() => {
      expect(sonnerToast.success).toHaveBeenCalled();
    });
  });

  /** ⭐ 空内容 ⇒ ⛔ 不写剪贴板，提示"没有可复制的内容"（不是静默复制一个空字符串）。 */
  it('[复制] 终端为空 ⇒ 不写剪贴板，提示没有可复制的内容', () => {
    term.getSelectionText.mockReturnValue('   ');
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });

    render(<TerminalMount sessionId="s1" sandboxId="s1" socketConfig={CFG} breadcrumb="A / B" />);
    fireEvent.click(screen.getByTestId('terminal-toolbar-copy'));

    expect(writeText).not.toHaveBeenCalled();
    expect(sonnerToast.error).toHaveBeenCalled();
  });

  it('[清屏] 调用 term.clear(sessionId)', () => {
    render(
      <TerminalMount sessionId="s-clear" sandboxId="sbx" socketConfig={CFG} breadcrumb="A / B" />,
    );
    fireEvent.click(screen.getByTestId('terminal-toolbar-clear'));
    expect(term.clear).toHaveBeenCalledWith('s-clear');
  });

  /**
   * ⭐ [A+]/[A-] 调 `term.setFontSize(sessionId, size)`，且每次点击都在上一次的基础上
   * 累加/递减（不是每次都从默认值重算）。
   *
   * 变异（已验证会让本例变红）：把步长从 `prev + 1` 改成 `prev + 2` ⇒ 第二次调用的
   * 参数值变成 17，与断言的 16 不符。
   *
   * ⚠️ 自查记录：最初想用"改成从闭包里的 `fontSize` 而不是函数式更新 `(prev) => …`
   * 取值"这个变异（经典 stale closure 写法）来证明这条测试的价值，实测**这个变异
   * 不会让本例变红**——`fireEvent.click` 之间 React 已经把上一次的 state 更新同步
   * flush 完，第二次点击时闭包读到的 `fontSize` 已经是最新值，两种写法在这个测试
   * 用例的时序下等价。换成上面"改步长"这个变异后确认能抓到，才收进正式用例。
   */
  it('[A+] 连续点击两次 ⇒ 字号累加，不是每次都从默认值重算', () => {
    render(
      <TerminalMount sessionId="s-font" sandboxId="sbx" socketConfig={CFG} breadcrumb="A / B" />,
    );
    fireEvent.click(screen.getByTestId('terminal-toolbar-font-increase'));
    fireEvent.click(screen.getByTestId('terminal-toolbar-font-increase'));
    expect(term.setFontSize).toHaveBeenNthCalledWith(1, 's-font', 15);
    expect(term.setFontSize).toHaveBeenNthCalledWith(2, 's-font', 16);
  });

  /** ⭐ 到下限后 [A-] 置灰，⛔ 不是可以一直点到字号变成负数。 */
  it('[A-] 连续点到下限 ⇒ 按钮置灰，不再继续调小', () => {
    render(
      <TerminalMount sessionId="s-min" sandboxId="sbx" socketConfig={CFG} breadcrumb="A / B" />,
    );
    const decrease = screen.getByTestId('terminal-toolbar-font-decrease');
    // 默认 14，下限 10：点 4 次到底，第 5 次应该已经置灰、不再触发。
    for (let i = 0; i < 4; i += 1) fireEvent.click(decrease);
    expect(term.setFontSize).toHaveBeenLastCalledWith('s-min', 10);
    expect(decrease).toBeDisabled();
    term.setFontSize.mockClear();
    fireEvent.click(decrease);
    expect(term.setFontSize).not.toHaveBeenCalled();
  });

  /**
   * ⭐ 「字号 persist」（P21-1 §6）的核心钉子：调过字号后**卸载重挂**（模拟换任务/
   * 刷新页面回来），新的挂载点从上次调到的值开始，而不是又回到默认的 14。
   *
   * 变异：把 `fontSize`/`setTerminalFontSize` 换回本地 `useState(DEFAULT_TERMINAL_FONT_SIZE)`
   * ⇒ 本例会红——重挂后的第一次 [A+] 会算出 15 而不是断言的 19。
   */
  it('字号改动跨挂载点持续存在（卸载重挂后接着上次的值调，不回默认值）', () => {
    const { unmount } = render(
      <TerminalMount
        sessionId="s-persist-1"
        sandboxId="sbx"
        socketConfig={CFG}
        breadcrumb="A / B"
      />,
    );
    fireEvent.click(screen.getByTestId('terminal-toolbar-font-increase'));
    fireEvent.click(screen.getByTestId('terminal-toolbar-font-increase'));
    fireEvent.click(screen.getByTestId('terminal-toolbar-font-increase'));
    fireEvent.click(screen.getByTestId('terminal-toolbar-font-increase'));
    // 14 → 18，四次 [A+]。
    expect(term.setFontSize).toHaveBeenLastCalledWith('s-persist-1', 18);
    unmount();

    term.setFontSize.mockClear();
    // 换一个任务/标签（不同 sessionId），模拟"打开另一个终端"——字号记忆是全局的。
    render(
      <TerminalMount
        sessionId="s-persist-2"
        sandboxId="sbx"
        socketConfig={CFG}
        breadcrumb="C / D"
      />,
    );
    fireEvent.click(screen.getByTestId('terminal-toolbar-font-increase'));
    // 接着上次的 18 往上加，不是回到 14 再 +1。
    expect(term.setFontSize).toHaveBeenLastCalledWith('s-persist-2', 19);
  });
});
