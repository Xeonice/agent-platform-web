// 多标签装配层的"胶水"回归（08 §5 / P21-1 §6）。
//
// 这一层能出的错全是胶水型的，而且每一条在界面上都不像报错：
//   · 切换标签用了条件渲染 ⇒ 实例被销毁重建（丢 WebGL 上下文 + 闪一下），看起来"只是慢"；
//   · 关标签没发 `close_shell` ⇒ 标签消失，沙箱里的 tmux 会话成了看不见的孤儿；
//   · 关一个**已被淘汰**的标签时找不到连接代发 ⇒ 同上，而且更难想到。
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { useAppStore } from '@/stores';
import { buildTerminalSocketConfig } from '@/lib/terminal/terminalSocket';
import type { TerminalClientFrame } from '@/types/ws-protocol';
import type { TerminalSocketConfig } from '@/types/terminal';

/**
 * `TerminalContainer` 的替身：记录它收到的 props，并把 `registerSend` 接线
 * （真实实现里那是 `TerminalMount` 的一个 effect）。
 *
 * ⛔ 替身必须真的调 `registerSend`，**而且卸载时要注销**（真实的 `TerminalMount`
 * 在 effect 的 cleanup 里传 `null`）。第一版忘了注销 ⇒ 被 LRU 淘汰的标签在
 * `senders` 里留下一个僵尸条目，于是"借一条连接代发"那条用例**借到了它自己**，
 * 照样绿 —— 一个比生产代码宽松的替身测出来的只是替身（12 §3.4 同一课）。
 */
const mounts = vi.hoisted(() => ({
  rendered: [] as { sessionId: string; active: boolean; query: Record<string, string> }[],
  sent: [] as { sessionId: string; frame: TerminalClientFrame }[],
  /** 每个挂载点收到的 `onShells`（只有 Agent 那条会被后端真的调到）。 */
  onShells: new Map<string, (shells: { shellId: string; runtimeId?: string }[] | null) => void>(),
}));
vi.mock('@/containers/terminal/TerminalContainer', () => ({
  TerminalContainer: ({
    sessionId,
    socketConfig,
    active,
    registerSend,
    onShells,
  }: {
    sessionId: string;
    socketConfig: TerminalSocketConfig;
    active?: boolean;
    registerSend?: (send: ((f: TerminalClientFrame) => boolean) | null) => void;
    onShells?: (shells: { shellId: string; runtimeId?: string }[] | null) => void;
  }) => {
    mounts.rendered.push({ sessionId, active: active ?? true, query: socketConfig.query });
    if (onShells !== undefined) mounts.onShells.set(sessionId, onShells);
    useEffect(() => {
      registerSend?.((frame) => {
        mounts.sent.push({ sessionId, frame });
        return true;
      });
      return () => {
        registerSend?.(null);
      };
    }, [sessionId, registerSend]);
    return <div data-testid={`mount-${sessionId}`} />;
  },
}));

import { TerminalTabsContainer } from '@/containers/terminal/TerminalTabsContainer';

const SANDBOX = 'sb-1';
const BASE = buildTerminalSocketConfig('http://h', SANDBOX);

beforeEach(() => {
  mounts.rendered.length = 0;
  mounts.sent.length = 0;
  mounts.onShells.clear();
  useAppStore.setState({
    shellTabsOf: new Map(),
    tabActivatedAt: new Map(),
    tabActivationTick: 0,
    shellTabSeqOf: new Map(),
    shellInventoryOf: new Map(),
    activeSessionOf: new Map(),
  });
});
afterEach(cleanup);

/**
 * ⚠️ 装配层现在要读 `GET /api/runtimes`（只为把 `codex` 译成「Codex」，06 §5.6），
 * 所以要有 QueryClient。⚠️ `retry:false`：用例里请求必然落空，重试只会让它们变慢。
 *
 * ⚠️ **拿不到展示名不阻断**：标签回落「终端 N」、下拉回落显示 id —— 这正是这里不给
 * 任何真实响应也能跑的原因，也是生产里请求还没回来那一瞬间的样子。
 */
function mount(availableRuntimes: string[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TerminalTabsContainer
        sandboxId={SANDBOX}
        socketConfig={BASE}
        availableRuntimes={availableRuntimes}
      />
    </QueryClientProvider>,
  );
}

/** 点「+ 新终端」。 */
function clickNewTerminal(): void {
  act(() => {
    screen.getByTestId('terminal-tab-new').click();
  });
}

describe('TerminalTabsContainer —— 标签栏与挂载点', () => {
  it('首次渲染只有 Agent 一个标签，且它没有 [×]', () => {
    mount();
    expect(screen.getByTestId(`terminal-tab-${SANDBOX}:0`)).toHaveTextContent('Agent');
    expect(screen.queryByTestId(`terminal-tab-close-${SANDBOX}:0`)).toBeNull();
  });

  it('⭐ [+ 新终端] ⇒ 多一个标签，它的连接带 `kind=shell`', () => {
    mount();
    clickNewTerminal();

    expect(screen.getByTestId(`terminal-tab-${SANDBOX}:shell:1`)).toHaveTextContent('终端 1');
    const shellMount = mounts.rendered.filter((m) => m.sessionId === `${SANDBOX}:shell:1`).at(-1);
    expect(shellMount?.query['kind']).toBe('shell');
    // Agent 那条不许被顺手改成 shell。
    const agentMount = mounts.rendered.filter((m) => m.sessionId === `${SANDBOX}:0`).at(-1);
    expect(agentMount?.query['kind']).toBeUndefined();
  });

  it('⭐ 切换标签：未选中的用 **display:none** 藏起来，挂载点**一个都不卸载**', () => {
    mount();
    clickNewTerminal();

    // 两个挂载点同时在 DOM 里（条件渲染的话这里只会有一个）。
    const agentPane = screen.getByTestId(`terminal-pane-${SANDBOX}:0`);
    const shellPane = screen.getByTestId(`terminal-pane-${SANDBOX}:shell:1`);
    expect(agentPane.style.display).toBe('none');
    expect(shellPane.style.display).toBe('block');
    // 实例本身也还在（替身渲出来的那个 div）。
    expect(screen.getByTestId(`mount-${SANDBOX}:0`)).toBeInTheDocument();

    act(() => {
      screen.getByTestId(`terminal-tab-${SANDBOX}:0`).click();
    });

    expect(screen.getByTestId(`terminal-pane-${SANDBOX}:0`).style.display).toBe('block');
    expect(screen.getByTestId(`terminal-pane-${SANDBOX}:shell:1`).style.display).toBe('none');
    // ⛔ 切过去之后被隐藏的那个**仍然挂着**（这条就是"不销毁实例"）。
    expect(screen.getByTestId(`mount-${SANDBOX}:shell:1`)).toBeInTheDocument();
  });

  it('前台标签拿到 `active:true`，后台拿到 false（后者靠它在切回时补一次 fit）', () => {
    mount();
    clickNewTerminal();
    const last = (id: string): boolean | undefined =>
      mounts.rendered.filter((m) => m.sessionId === id).at(-1)?.active;
    expect(last(`${SANDBOX}:shell:1`)).toBe(true);
    expect(last(`${SANDBOX}:0`)).toBe(false);
  });
});

describe('TerminalTabsContainer —— 关标签 = 销毁那一个后端会话', () => {
  /** 让 shell 标签拿到后端下发的 shellId（真实路径是 `session` 首帧）。 */
  function adopt(sessionId: string, shellId: string): void {
    act(() => {
      useAppStore.getState().adoptShellId(SANDBOX, sessionId, shellId);
    });
  }

  it('⭐ 点 [×] ⇒ 发 `close_shell{shellId}`，标签从栏上消失', () => {
    mount();
    clickNewTerminal();
    adopt(`${SANDBOX}:shell:1`, 'a'.repeat(32));

    act(() => {
      screen.getByTestId(`terminal-tab-close-${SANDBOX}:shell:1`).click();
    });

    expect(mounts.sent).toEqual([
      { sessionId: `${SANDBOX}:shell:1`, frame: { type: 'close_shell', shellId: 'a'.repeat(32) } },
    ]);
    expect(screen.queryByTestId(`terminal-tab-${SANDBOX}:shell:1`)).toBeNull();
  });

  it('⚠️ shellId 还没回来就关 ⇒ **一帧都不发**（不发空 id 让后端去猜）', () => {
    mount();
    clickNewTerminal();

    act(() => {
      screen.getByTestId(`terminal-tab-close-${SANDBOX}:shell:1`).click();
    });

    expect(mounts.sent).toEqual([]);
    expect(screen.queryByTestId(`terminal-tab-${SANDBOX}:shell:1`)).toBeNull();
  });

  it('⭐ 关一个**已被 LRU 淘汰**的标签 ⇒ 借当前标签那条连接代发', () => {
    mount();
    // 开够标签把第一个 shell 挤出 mounted（当前标签永不被淘汰，08 §5.3）。
    for (let i = 0; i < 7; i += 1) clickNewTerminal();
    adopt(`${SANDBOX}:shell:1`, 'b'.repeat(32));

    const evictedPane = screen.queryByTestId(`terminal-pane-${SANDBOX}:shell:1`);
    expect(evictedPane).toBeNull(); // 已经没有实例了……
    expect(screen.getByTestId(`terminal-tab-${SANDBOX}:shell:1`)).toBeInTheDocument(); // ……但标签还在

    act(() => {
      screen.getByTestId(`terminal-tab-close-${SANDBOX}:shell:1`).click();
    });

    // 少了这一手，淘汰过的标签点 [×] 只会让它从界面上消失，而沙箱里那个 tmux 会话
    // 成了看不见也关不掉的孤儿。代发者是当前标签（不是被关的那个）。
    expect(mounts.sent).toHaveLength(1);
    expect(mounts.sent[0]?.frame).toEqual({ type: 'close_shell', shellId: 'b'.repeat(32) });
    expect(mounts.sent[0]?.sessionId).not.toBe(`${SANDBOX}:shell:1`);
  });
});

/**
 * 刷新后恢复的装配（06 §5.5）：清单从 **Agent 那条连接**的 `shells` 帧进来，
 * 标签栏补回来，第三态就地说出来。
 */
describe('TerminalTabsContainer —— 后端清单接线', () => {
  const A = 'a'.repeat(32);
  const B = 'b'.repeat(32);

  /** 模拟后端在某条连接上推来 `shells` 帧。 */
  function pushShells(
    sessionId: string,
    shells: { shellId: string; runtimeId?: string }[] | null,
  ): void {
    act(() => {
      mounts.onShells.get(sessionId)?.(shells);
    });
  }

  it('⭐ 刷新后：Agent 连接推来清单 ⇒ 标签补回来，点得回去', () => {
    mount();
    expect(screen.queryByTestId(`terminal-tab-${SANDBOX}:shell:1`)).toBeNull();

    pushShells(`${SANDBOX}:0`, [{ shellId: A }, { shellId: B }]);

    expect(screen.getByTestId(`terminal-tab-${SANDBOX}:shell:1`)).toHaveTextContent('终端 1');
    expect(screen.getByTestId(`terminal-tab-${SANDBOX}:shell:2`)).toHaveTextContent('终端 2');

    act(() => {
      screen.getByTestId(`terminal-tab-${SANDBOX}:shell:1`).click();
    });
    // 点回去接的是**原来那个会话**（带 shellId），不是新开一个。
    const last = mounts.rendered.filter((m) => m.sessionId === `${SANDBOX}:shell:1`).at(-1);
    expect(last?.query['shellId']).toBe(A);
    expect(last?.query['kind']).toBe('shell');
  });

  it('⛔ 清单为 null（问不出来）⇒ 标签栏**就地说查不到**，不许静默、不许当成"没有"', () => {
    mount();
    pushShells(`${SANDBOX}:0`, null);

    const notice = screen.getByTestId('terminal-inventory-unavailable');
    expect(notice.textContent).toContain('查不到');
    // ⛔ 不许说成"没有别的终端"——我们不知道。
    expect(notice.textContent).not.toContain('没有');
  });

  it('确认没有（空清单）⇒ **不**出现那句话（它只属于"查不到"）', () => {
    mount();
    pushShells(`${SANDBOX}:0`, []);
    expect(screen.queryByTestId('terminal-inventory-unavailable')).toBeNull();
    expect(screen.queryByTestId(`terminal-tab-${SANDBOX}:shell:1`)).toBeNull();
  });

  it('⛔ 只加不减：清单里没有的本地标签不许被抹掉', () => {
    mount();
    clickNewTerminal(); // 刚开的，服务端清单里还没有它
    pushShells(`${SANDBOX}:0`, [{ shellId: A }]);

    expect(screen.getByTestId(`terminal-tab-${SANDBOX}:shell:1`)).toBeInTheDocument();
    expect(screen.getByTestId(`terminal-tab-${SANDBOX}:shell:2`)).toBeInTheDocument();
  });
});
