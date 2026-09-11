// 多终端标签的集合与激活（08 §5 / P21-1 §6）。
//
// 这组用例钉住的是「多标签」这件事在前端的全部产品行为：
//   · Agent 标签恒在、恒不可关（裁决 D-15 在界面上的落点）；
//   · [+ 新终端] 开的是**独立会话**（握手带 `kind=shell`，而不是再 attach 一次）；
//   · 切换**不销毁实例**（由装配层用 display 做；这里钉的是"mounted 集合不因切换而缩"）；
//   · LRU 上限 + 被淘汰的标签仍在栏上，点一下就回来（静默重建）；
//   · 关标签要交出 shellId 去销毁后端会话，而 Agent 标签交不出任何东西。
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTerminalSessions } from '@/hooks/terminal/useTerminalSessions';
import { useAppStore } from '@/stores';
import { buildTerminalSocketConfig } from '@/lib/terminal/terminalSocket';
import { TERMINAL_INSTANCE_LIMIT } from '@/lib/terminal/terminalTabs';

const SANDBOX = 'sb-1';
const BASE = buildTerminalSocketConfig('http://h', SANDBOX, { cols: 120, rows: 40 });

beforeEach(() => {
  useAppStore.setState({
    shellTabsOf: new Map(),
    tabActivatedAt: new Map(),
    tabActivationTick: 0,
    shellTabSeqOf: new Map(),
    shellInventoryOf: new Map(),
    activeSessionOf: new Map(),
  });
});

function render() {
  return renderHook(() => useTerminalSessions(SANDBOX, BASE));
}

describe('useTerminalSessions —— Agent 标签', () => {
  it('⭐ 恒在、恒选中、**恒不可关**；它的连接**不带** kind（缺省就是 agent）', () => {
    const { result } = render();
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0]).toMatchObject({
      sessionId: `${SANDBOX}:0`,
      kind: 'agent',
      label: 'Agent',
      closable: false,
    });
    expect(result.current.activeSessionId).toBe(`${SANDBOX}:0`);
    // ⛔ agent 那一支不许带 `kind=agent`：缺省就是它，少一个参数就少一处会漂的地方，
    //    也让新旧连接串逐字一致（后端对不带 kind 的旧客户端零影响）。
    expect(result.current.tabs[0]?.socketConfig.query['kind']).toBeUndefined();
    expect(result.current.tabs[0]?.socketConfig.query['sandboxId']).toBe(SANDBOX);
  });

  it('⛔ 对 Agent 标签调 closeTab ⇒ 什么都不发生（兜住键盘等旁路触发）', () => {
    const { result } = render();
    let shellId: string | undefined = 'x';
    act(() => {
      shellId = result.current.closeTab(`${SANDBOX}:0`);
    });
    // 它既不交出任何要销毁的会话，也不许把自己从标签栏上摘掉。
    expect(shellId).toBeUndefined();
    expect(result.current.tabs).toHaveLength(1);
  });
});

describe('useTerminalSessions —— [+ 新终端]', () => {
  it('⭐ 新标签的握手带 `kind=shell`，而**不是**再 attach 一次 agent 那个会话', () => {
    const { result } = render();
    act(() => {
      result.current.openShellTab();
    });

    expect(result.current.tabs).toHaveLength(2);
    const shell = result.current.tabs[1];
    expect(shell).toMatchObject({ kind: 'shell', label: '终端 1', closable: true });
    // 这一条就是整个改造的要害：少了 `kind=shell`，后端会再 attach 一次
    // `platform-agent`，而 tmux 多 client attach 同一 session 看到的是**同一块屏幕**
    // ——"第二个终端"会变成第一个的镜像，敲进去的字都落进正在跑的 agent。
    expect(shell?.socketConfig.query['kind']).toBe('shell');
    // 刚开的标签还不知道后端会给它什么会话 id ⇒ **不带** shellId（由后端现生成）。
    expect(shell?.socketConfig.query['shellId']).toBeUndefined();
    // 新开的标签自动切到前台。
    expect(result.current.activeSessionId).toBe(shell?.sessionId);
  });

  it('连开两个 ⇒ 两个不同的 sessionId、两个不同的名字（不复用序号）', () => {
    const { result } = render();
    act(() => {
      result.current.openShellTab();
    });
    act(() => {
      result.current.openShellTab();
    });
    expect(result.current.tabs.map((t) => t.label)).toEqual(['Agent', '终端 1', '终端 2']);
    expect(new Set(result.current.tabs.map((t) => t.sessionId)).size).toBe(3);
  });

  it('关掉「终端 1」再新开 ⇒ 叫「终端 2」，**不重用**刚腾出来的序号', () => {
    // 重用序号会让刚关掉的标签与新开的同名，而它们背后是两个不同的 tmux 会话 ——
    // 用户按名字回忆"我刚才在哪个窗口跑的构建"时会认错。
    const { result } = render();
    act(() => {
      result.current.openShellTab();
    });
    const first = result.current.tabs[1]?.sessionId ?? '';
    act(() => {
      result.current.closeTab(first);
    });
    act(() => {
      result.current.openShellTab();
    });
    expect(result.current.tabs.map((t) => t.label)).toEqual(['Agent', '终端 2']);
  });
});

describe('useTerminalSessions —— shellId 的来处与去处', () => {
  it('⭐ 首帧回来后记住 shellId ⇒ 重建时带回去（否则每次重建都在沙箱里多一个孤儿会话）', () => {
    const { result } = render();
    act(() => {
      result.current.openShellTab();
    });
    const sessionId = result.current.tabs[1]?.sessionId ?? '';

    act(() => {
      result.current.adoptShellId(sessionId, 'a'.repeat(32));
    });

    expect(result.current.tabs[1]?.shellId).toBe('a'.repeat(32));
    expect(result.current.tabs[1]?.socketConfig.query['shellId']).toBe('a'.repeat(32));
  });

  it('关标签交出 shellId（装配层据它发 close_shell）', () => {
    const { result } = render();
    act(() => {
      result.current.openShellTab();
    });
    const sessionId = result.current.tabs[1]?.sessionId ?? '';
    act(() => {
      result.current.adoptShellId(sessionId, 'b'.repeat(32));
    });

    let handed: string | undefined;
    act(() => {
      handed = result.current.closeTab(sessionId);
    });

    expect(handed).toBe('b'.repeat(32));
    expect(result.current.tabs).toHaveLength(1);
    // 关掉的是当前标签 ⇒ 回落到 Agent（唯一保证存在的那个）。
    expect(result.current.activeSessionId).toBe(`${SANDBOX}:0`);
  });

  it('⚠️ 首帧还没回来就关 ⇒ 交出 undefined（装配层据此**不发**空 id 让后端去猜）', () => {
    const { result } = render();
    act(() => {
      result.current.openShellTab();
    });
    const sessionId = result.current.tabs[1]?.sessionId ?? '';
    let handed: string | undefined = 'x';
    act(() => {
      handed = result.current.closeTab(sessionId);
    });
    expect(handed).toBeUndefined();
    expect(result.current.tabs).toHaveLength(1);
  });
});

describe('useTerminalSessions —— 切换与 LRU（08 §5.2/§5.3）', () => {
  it('⭐ 切换标签**不把任何标签从 mounted 里摘掉**（实例不销毁，只是被 display 藏起来）', () => {
    const { result } = render();
    act(() => {
      result.current.openShellTab();
    });
    const before = [...result.current.mountedSessionIds];

    act(() => {
      result.current.selectTab(`${SANDBOX}:0`);
    });

    // 切回 Agent 之后，刚才那个 shell 标签的实例必须还在（否则就是"每切一次销毁重建"，
    // 会丢 WebGL 上下文，还要闪一下"清空→重连→重绘"）。
    expect(result.current.mountedSessionIds).toEqual(before);
    expect(result.current.activeSessionId).toBe(`${SANDBOX}:0`);
  });

  it('⭐ 超过上限时淘汰最久未激活的，但**标签栏上一个都不少**', () => {
    const { result } = render();
    // Agent + N 个 shell，凑到超过上限。
    act(() => {
      for (let i = 0; i < TERMINAL_INSTANCE_LIMIT; i += 1) result.current.openShellTab();
    });

    expect(result.current.tabs).toHaveLength(TERMINAL_INSTANCE_LIMIT + 1);
    // 实例被压在上限内……
    expect(result.current.mountedSessionIds).toHaveLength(TERMINAL_INSTANCE_LIMIT);
    // ……而标签栏仍然列着全部（被淘汰的只是没有实例，不是没有标签，08 §5.2）。
    expect(result.current.mountedSessionIds.length).toBeLessThan(result.current.tabs.length);
    // 当前标签永不被淘汰。
    expect(result.current.mountedSessionIds).toContain(result.current.activeSessionId);
  });

  it('⭐ 点一下被淘汰的标签 ⇒ 它回到 mounted（静默重建，⛔ 不提示不确认）', () => {
    const { result } = render();
    act(() => {
      for (let i = 0; i < TERMINAL_INSTANCE_LIMIT; i += 1) result.current.openShellTab();
    });
    const evicted = result.current.tabs
      .map((t) => t.sessionId)
      .find((id) => !result.current.mountedSessionIds.includes(id));
    expect(evicted).toBeDefined();

    act(() => {
      result.current.selectTab(evicted ?? '');
    });

    expect(result.current.mountedSessionIds).toContain(evicted);
    expect(result.current.activeSessionId).toBe(evicted);
  });

  it('store 里留着一个已经不存在的选中 id ⇒ 回落到 Agent，而不是渲染不出任何终端', () => {
    useAppStore.getState().setActiveSession(SANDBOX, `${SANDBOX}:shell:999`);
    const { result } = render();
    expect(result.current.activeSessionId).toBe(`${SANDBOX}:0`);
    expect(result.current.mountedSessionIds).toContain(`${SANDBOX}:0`);
  });
});

/**
 * 刷新后的恢复（06 §5.5）。
 *
 * 它修的是什么：tmux 会话活在沙箱里、活过刷新，而"有哪几个标签"只活在浏览器内存里
 * （`shellId` 是会话凭据，15 §3.5 不许 persist）。⇒ 刷一下页面，那些会话就变成**还活着
 * 但界面上没有**的孤儿。而"看不见但还活着比关掉更糟"正是「关标签要销毁」的立论。
 */
describe('useTerminalSessions —— 后端清单（刷新后恢复）', () => {
  const A = 'a'.repeat(32);
  const B = 'b'.repeat(32);

  it('⭐ 刷新后（只有 Agent 标签）收到清单 ⇒ 标签补回来，且**能点回去**', () => {
    const { result } = render();
    expect(result.current.tabs).toHaveLength(1); // 刷新后的起点

    act(() => {
      result.current.receiveShellInventory([{ shellId: A }, { shellId: B }]);
    });

    expect(result.current.tabs.map((t) => t.label)).toEqual(['Agent', '终端 1', '终端 2']);
    // 恢复出来的标签必须带着 shellId ⇒ 点回去时接的是**原来那个会话**，不是新开一个。
    expect(result.current.tabs[1]?.shellId).toBe(A);
    expect(result.current.tabs[1]?.socketConfig.query['shellId']).toBe(A);
    expect(result.current.tabs[1]?.socketConfig.query['kind']).toBe('shell');

    const restored = result.current.tabs[1]?.sessionId ?? '';
    act(() => {
      result.current.selectTab(restored);
    });
    expect(result.current.activeSessionId).toBe(restored);
    expect(result.current.mountedSessionIds).toContain(restored);
  });

  it('⚠️ 清单顺序 = tmux 创建顺序 ⇒ 「终端 1..n」按创建顺序编（刷新后可能位移，已知代价）', () => {
    const { result } = render();
    act(() => {
      result.current.receiveShellInventory([{ shellId: B }, { shellId: A }]); // 后端已按 session_created 升序给
    });
    expect(result.current.tabs[1]?.shellId).toBe(B); // 先创建的排前面 = 终端 1
    expect(result.current.tabs[1]?.label).toBe('终端 1');
    expect(result.current.tabs[2]?.shellId).toBe(A);
  });

  it('⛔ **只加不减**：清单里没有的本地标签不许被抹掉', () => {
    // 重连时清单会再来一次；一个刚点了 [+ 新终端]、`session` 首帧还没回来的标签
    // **不在服务端清单里** —— 拿清单做全量 reconcile 会让用户眼睁睁看着它消失。
    const { result } = render();
    act(() => {
      result.current.openShellTab();
    });
    const pending = result.current.tabs[1]?.sessionId ?? '';

    act(() => {
      result.current.receiveShellInventory([{ shellId: A }]);
    });

    expect(result.current.tabs.map((t) => t.sessionId)).toContain(pending);
    expect(result.current.tabs).toHaveLength(3); // Agent + 刚开的 + 恢复的
  });

  it('⛔ 清单里已经认识的 id 不重复建标签（重连会再来一次）', () => {
    const { result } = render();
    act(() => {
      result.current.receiveShellInventory([{ shellId: A }, { shellId: B }]);
    });
    act(() => {
      result.current.receiveShellInventory([{ shellId: A }, { shellId: B }]);
    });
    expect(result.current.tabs).toHaveLength(3);
  });

  it('⭐ 竞态：清单先补了 X，本地那个刚开的标签随后认领 X ⇒ **合并成一个**，不留镜像', () => {
    // 这是唯一能造出"两个标签背后同一个 tmux 会话"的路径（同一块屏幕的镜像，正是
    // 多标签要消灭的现象）。判据是**身份撞了**，不是"服务端没报它" —— 所以它不违反只加不减。
    const { result } = render();
    act(() => {
      result.current.openShellTab();
    });
    const mine = result.current.tabs[1]?.sessionId ?? '';
    act(() => {
      result.current.receiveShellInventory([{ shellId: A }]); // 清单把 A 当成"还没认领的"补了进来
    });
    expect(result.current.tabs).toHaveLength(3);

    act(() => {
      result.current.adoptShellId(mine, A); // 首帧到了：我这个标签就是 A
    });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.tabs[1]?.sessionId).toBe(mine); // 留下正在连着的那个
    expect(result.current.tabs[1]?.shellId).toBe(A);
  });
});

describe('useTerminalSessions —— 清单的三态（⛔「不知道」不能说成「没有」）', () => {
  it('还没问到 ⇒ 什么都不说（inventoryUnavailable 为 false）', () => {
    const { result } = render();
    expect(result.current.inventoryUnavailable).toBe(false);
  });

  it('确认没有（空清单）⇒ 仍然什么都不说，标签栏就是只有 Agent', () => {
    const { result } = render();
    act(() => {
      result.current.receiveShellInventory([]);
    });
    expect(result.current.inventoryUnavailable).toBe(false);
    expect(result.current.tabs).toHaveLength(1);
  });

  it('⭐ 问不出来（null）⇒ **说出来**，且一个标签都不动', () => {
    const { result } = render();
    act(() => {
      result.current.openShellTab();
    });
    act(() => {
      result.current.receiveShellInventory(null);
    });
    expect(result.current.inventoryUnavailable).toBe(true);
    // 既不补也不删：不知道的时候什么都别做。
    expect(result.current.tabs).toHaveLength(2);
  });

  it('⚠️ 先 null 后问到 ⇒ 那句"查不到"要收回去', () => {
    const { result } = render();
    act(() => {
      result.current.receiveShellInventory(null);
    });
    act(() => {
      result.current.receiveShellInventory([{ shellId: 'c'.repeat(32) }]);
    });
    expect(result.current.inventoryUnavailable).toBe(false);
    expect(result.current.tabs).toHaveLength(2);
  });
});

/**
 * 标签能选跑什么 CLI（06 §5.6）。
 *
 * ⚠️ 这**不是**「发起一个任务」：任务走 `buildStartCommand` + 建 AgentTask（产物 /
 * 审计 / 超时 / 可取消都挂在它上面），标签走 `buildAttachCommand`、不带指令、不记账。
 */
describe('useTerminalSessions —— [+ 新终端] 能开什么', () => {
  const NAMES = new Map([
    ['codex', 'Codex'],
    ['claude-code', 'Claude Code'],
  ]);
  const renderWith = (available: string[]) =>
    renderHook(() => useTerminalSessions(SANDBOX, BASE, available, NAMES));

  it('⛔ 下拉只列**这个沙箱里真的能跑的**，⛔ 不是 /api/runtimes 全集', () => {
    // 没注入凭证的 CLI 列出来就是一个点开必然失败的选项 —— "点了再报错"正是要避免的形状。
    const { result } = renderWith(['codex']);
    expect(result.current.launchOptions).toEqual([
      { runtimeId: 'codex', label: 'Codex' },
      { label: '终端' }, // 纯终端永远在，且排最后
    ]);
  });

  it('一个都没有 ⇒ 只剩「终端」（诚实降级，不拿全集兜底）', () => {
    const { result } = renderWith([]);
    expect(result.current.launchOptions).toEqual([{ label: '终端' }]);
  });

  it('⭐ 开一个 CLI 标签 ⇒ `kind=runtime` + `runtimeId`，名字带上 CLI', () => {
    const { result } = renderWith(['codex', 'claude-code']);
    act(() => {
      result.current.openShellTab('claude-code');
    });

    const tab = result.current.tabs[1];
    expect(tab?.kind).toBe('runtime');
    expect(tab?.label).toBe('Claude Code 1');
    expect(tab?.socketConfig.query['kind']).toBe('runtime');
    expect(tab?.socketConfig.query['runtimeId']).toBe('claude-code');
    // 它仍然是用户自己开的 ⇒ 可关（与 Agent 标签的分界）。
    expect(tab?.closable).toBe(true);
  });

  it('⭐ 开纯终端 ⇒ `kind=shell`，**不带** runtimeId，名字是「终端 N」', () => {
    const { result } = renderWith(['codex']);
    act(() => {
      result.current.openShellTab();
    });
    const tab = result.current.tabs[1];
    expect(tab?.kind).toBe('shell');
    expect(tab?.label).toBe('终端 1');
    expect(tab?.socketConfig.query['kind']).toBe('shell');
    expect(tab?.socketConfig.query).not.toHaveProperty('runtimeId');
  });

  it('⭐ 「Agent」标签与用户开的「Codex 1」名字**分得开**（同一个 CLI，两种身份）', () => {
    const { result } = renderWith(['codex']);
    act(() => {
      result.current.openShellTab('codex');
    });
    expect(result.current.tabs.map((t) => t.label)).toEqual(['Agent', 'Codex 1']);
    // 一个是任务本身（关不掉），一个是随手开的（可关）—— 名字不同才说得清。
    expect(result.current.tabs[0]?.closable).toBe(false);
    expect(result.current.tabs[1]?.closable).toBe(true);
  });

  it('⚠️ 展示名取不到 ⇒ 标签回落「终端 N」，⛔ 不用半生不熟的 runtime id 当名字', () => {
    // `claude-code 2` 看起来像个 bug；「终端 2」至少是诚实的。
    const { result } = renderHook(() => useTerminalSessions(SANDBOX, BASE, ['codex'], new Map()));
    act(() => {
      result.current.openShellTab('codex');
    });
    expect(result.current.tabs[1]?.label).toBe('终端 1');
    // 但下拉里用 id 兜底 —— 那里必须有个能点的东西，而 id 是准确的。
    expect(result.current.launchOptions[0]).toEqual({ runtimeId: 'codex', label: 'codex' });
  });

  it('⭐ 刷新恢复：清单带回 runtimeId ⇒ 标签名照样叫得对', () => {
    const { result } = renderWith(['codex', 'claude-code']);
    act(() => {
      result.current.receiveShellInventory([
        { shellId: 'a'.repeat(32) },
        { shellId: 'b'.repeat(32), runtimeId: 'claude-code' },
      ]);
    });
    expect(result.current.tabs.map((t) => t.label)).toEqual(['Agent', '终端 1', 'Claude Code 2']);
    expect(result.current.tabs[2]?.socketConfig.query['runtimeId']).toBe('claude-code');
  });

  it('⚠️ 清单里没有 runtimeId ⇒ 当纯终端，⛔ 不许猜成沙箱的默认 runtime', () => {
    const { result } = renderWith(['codex']);
    act(() => {
      result.current.receiveShellInventory([{ shellId: 'a'.repeat(32) }]);
    });
    expect(result.current.tabs[1]?.kind).toBe('shell');
    expect(result.current.tabs[1]?.socketConfig.query).not.toHaveProperty('runtimeId');
  });

  it('⛔ 首帧回来时**不许把标签的 runtime 身份抹掉**', () => {
    const { result } = renderWith(['codex']);
    act(() => {
      result.current.openShellTab('codex');
    });
    const sessionId = result.current.tabs[1]?.sessionId ?? '';
    act(() => {
      result.current.adoptShellId(sessionId, 'a'.repeat(32));
    });
    // 整条替换会让「我是 Codex 标签」这件事在拿到 shellId 的一瞬间消失。
    expect(result.current.tabs[1]?.runtimeId).toBe('codex');
    expect(result.current.tabs[1]?.label).toBe('Codex 1');
  });
});
