// 同一个 Task 的**终端会话集合与激活**（08 §5.1 目录树里列的那个 hook / P21-1 §6）。
//
// 它回答标签栏和装配层需要的全部问题：
//   · 有哪几个标签、分别叫什么、哪个能关（Agent 那个永远不能）；
//   · 哪个在前台（切换**不销毁实例**，由装配层用 display 隐藏，08 §5.2）；
//   · 这一刻该**挂载**哪几个（LRU 上限，被淘汰的标签仍在栏上，点一下静默重建）；
//   · 每个标签各自的 WS 连接描述（`kind=shell` / 已知的 `shellId`）。
//
// ⚠️ 它**不持有** xterm 实例，也不碰 socket —— 那是 `useTerminalInstance` 与
//    `useSandboxTerminalSocket` 的事。这里只管"有哪几个标签、谁在前台"。
import { useCallback, useMemo } from 'react';
import { useAppStore } from '@/stores';
import { agentSessionIdOf } from '@/stores/createTerminalTabsSlice';
import { withTerminalTarget } from '@/lib/terminal/terminalSocket';
import {
  AGENT_TAB_LABEL,
  selectMountedSessions,
  shellTabLabel,
  shellTabSeqOf,
  TERMINAL_INSTANCE_LIMIT,
} from '@/lib/terminal/terminalTabs';
import type { TerminalSocketConfig } from '@/types/terminal';
import type { TerminalSessionKind, TerminalShellSummary } from '@/types/ws-protocol';

export interface TerminalTabModel {
  /** 前端标签身份，也是 xterm 实例与 registry 的键（≠ 后端的 socketSessionKey）。 */
  sessionId: string;
  kind: TerminalSessionKind;
  label: string;
  /** Agent 那个恒为 false —— 关掉它等于关掉任务本身（裁决 D-15）。 */
  closable: boolean;
  /** 这个标签自己的连接描述（已带 `kind`/`shellId`）。 */
  socketConfig: TerminalSocketConfig;
  /** 后端分配的 tmux 会话 id；`undefined` = 还没连上过 / 是 Agent 标签。 */
  shellId?: string;
  /** 这个标签里跑的 agent CLI（06 §5.6）；`undefined` = 纯终端 / Agent 标签。 */
  runtimeId?: string;
}

/** [+ 新终端] 下拉里的一项（06 §5.6）。 */
export interface TerminalLaunchOption {
  /** `undefined` = 纯终端（`$SHELL`）。 */
  runtimeId?: string;
  label: string;
}

export interface UseTerminalSessionsApi {
  tabs: TerminalTabModel[];
  activeSessionId: string;
  /** 这一刻该挂载哪几个（⊆ tabs，LRU 上限内）。其余标签在栏上但没有实例。 */
  mountedSessionIds: string[];
  selectTab: (sessionId: string) => void;
  /**
   * [+ 新终端]：新开一个独立标签并切过去。
   * `runtimeId` 省略 = 纯终端；给了 = 在里面跑那个 agent CLI（06 §5.6）。
   */
  openShellTab: (runtimeId?: string) => void;
  /**
   * [+ 新终端] 下拉里能选什么（06 §5.6）。
   *
   * ⛔ 数据源是**沙箱行上那条记录**（`availableRuntimes`），⛔ 不是 `/api/runtimes`
   * 全集，也不是"现在配了哪些凭证"：没注入进这个盒子的 CLI 列出来只会是一个点开就
   * 失败的选项，而"现在配了什么"与"盒子里有什么"在 provision 之后就分叉了。
   */
  launchOptions: TerminalLaunchOption[];
  /** [×]：关标签。返回要销毁的后端会话 id（`undefined` = 还没拿到 / 不该关）。 */
  closeTab: (sessionId: string) => string | undefined;
  /** `session` 首帧带回 shellId 时调，记进标签状态供重建时带回。 */
  adoptShellId: (sessionId: string, shellId: string) => void;
  /** 后端 `shells` 帧到达时调（06 §5.5）。`null` = 问不出来，只记状态不动标签。 */
  receiveShellInventory: (shells: TerminalShellSummary[] | null) => void;
  /**
   * 「这个任务下还有没有别的终端，现在**查不到**」。
   *
   * ⛔ 它与"确认没有"必须分开渲染：把查不到说成没有，用户会以为自己的终端丢了（或者
   * 以为自己没开过），而真相可能是有三个正跑着东西的终端在沙箱里（06 §5.5 三态）。
   */
  inventoryUnavailable: boolean;
}

/**
 * @param sandboxId 这一屏的 Task。
 * @param baseConfig `useTerminalSocketConfig` 给的基础连接描述（不带 kind/shellId）。
 */
export function useTerminalSessions(
  sandboxId: string,
  baseConfig: TerminalSocketConfig,
  /**
   * 这个沙箱里能跑哪几个 runtime（`SandboxDto.availableRuntimes`，06 §5.6）。
   * 缺省空 ⇒ 下拉里只有「终端」这一项 —— 那是诚实的降级：我们不知道能开什么，
   * 就只给一定能开的那个。⛔ 不许在这里用 `/api/runtimes` 全集兜底。
   */
  availableRuntimes: readonly string[] = [],
  /** runtimeId → 展示名（`GET /api/runtimes`）。查不到就回落「终端 N」，见 `shellTabLabel`。 */
  runtimeNames: ReadonlyMap<string, string> = new Map(),
): UseTerminalSessionsApi {
  const shellTabs = useAppStore((s) => s.shellTabsOf.get(sandboxId));
  const activatedAt = useAppStore((s) => s.tabActivatedAt);
  const activeOf = useAppStore((s) => s.activeSessionOf.get(sandboxId));
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const markTabActivated = useAppStore((s) => s.markTabActivated);
  const openShellTabAction = useAppStore((s) => s.openShellTab);
  const closeShellTabAction = useAppStore((s) => s.closeShellTab);
  const adoptShellIdAction = useAppStore((s) => s.adoptShellId);
  const recordShellInventory = useAppStore((s) => s.recordShellInventory);
  const inventoryState = useAppStore((s) => s.shellInventoryOf.get(sandboxId));

  const agentSessionId = agentSessionIdOf(sandboxId);

  const tabs = useMemo<TerminalTabModel[]>(
    () => [
      {
        sessionId: agentSessionId,
        kind: 'agent',
        label: AGENT_TAB_LABEL,
        // ⛔ Agent 标签没有 [×]。关掉它并不会停下任务（后端只会 detach），
        //    所以那个按钮唯一能做到的就是**误导** —— 让人以为按了就停了。
        closable: false,
        socketConfig: withTerminalTarget(baseConfig, { kind: 'agent' }),
      },
      ...(shellTabs ?? []).map<TerminalTabModel>((t) => ({
        sessionId: t.sessionId,
        kind: t.runtimeId === undefined ? 'shell' : 'runtime',
        label: shellTabLabel(
          shellTabSeqOf(t.sessionId),
          t.runtimeId === undefined ? undefined : runtimeNames.get(t.runtimeId),
        ),
        closable: true,
        socketConfig: withTerminalTarget(baseConfig, {
          kind: t.runtimeId === undefined ? 'shell' : 'runtime',
          ...(t.shellId === undefined ? {} : { shellId: t.shellId }),
          ...(t.runtimeId === undefined ? {} : { runtimeId: t.runtimeId }),
        }),
        ...(t.shellId === undefined ? {} : { shellId: t.shellId }),
        ...(t.runtimeId === undefined ? {} : { runtimeId: t.runtimeId }),
      })),
    ],
    [agentSessionId, shellTabs, baseConfig, runtimeNames],
  );

  /**
   * 下拉里的选项：**先列 CLI，最后是纯终端**。
   *
   * ⚠️ 顺序是有意的：用户点 [+ 新终端] 多半是想开一个 agent，纯终端是兜底那一项。
   * ⚠️ 展示名查不到时用 id 兜底（下拉里必须有个能点的东西，而这里 id 至少是准确的 ——
   *    与标签名那边的取舍不同：标签上 `claude-code 2` 看起来像 bug，下拉里 `claude-code`
   *    看起来只是没本地化）。
   */
  const launchOptions = useMemo<TerminalLaunchOption[]>(
    () => [
      ...availableRuntimes.map((id) => ({ runtimeId: id, label: runtimeNames.get(id) ?? id })),
      { label: '终端' },
    ],
    [availableRuntimes, runtimeNames],
  );

  /**
   * 选中态取自 registry 的 `activeSessionOf`（08 §5.1 已定的形状，⛔ 不另起一份）。
   *
   * ⚠️ 兜底回 Agent 标签而不是"第一个标签"：选中的那个标签可能刚被关掉，
   * 而 Agent 那个是**唯一保证存在**的。另外要挡住"store 里还留着一个已经不存在的
   * sessionId"——那会让整屏渲染不出任何终端。
   */
  const activeSessionId =
    activeOf !== undefined && tabs.some((t) => t.sessionId === activeOf)
      ? activeOf
      : agentSessionId;

  const mountedSessionIds = useMemo(
    () =>
      selectMountedSessions(
        tabs.map((t) => t.sessionId),
        activatedAt,
        activeSessionId,
        TERMINAL_INSTANCE_LIMIT,
      ),
    [tabs, activatedAt, activeSessionId],
  );

  const selectTab = useCallback(
    (sessionId: string): void => {
      setActiveSession(sandboxId, sessionId);
      // ⚠️ LRU 的输入**只有**这一处（08 §5.3）：不要在 write / 收帧时也 touch，
      //    否则一个刷屏的后台标签会把自己顶成"最近使用"，挤掉用户正在看的那个。
      markTabActivated(sessionId);
    },
    [sandboxId, setActiveSession, markTabActivated],
  );

  const openShellTab = useCallback(
    (runtimeId?: string): void => {
      const sessionId = openShellTabAction(sandboxId, runtimeId);
      setActiveSession(sandboxId, sessionId);
    },
    [sandboxId, openShellTabAction, setActiveSession],
  );

  /**
   * 关标签。返回这个标签背后那个 tmux 会话的 id，交给装配层发 `close_shell`。
   *
   * ⛔ Agent 标签直接回 `undefined` 且**不动任何状态** —— 界面上本来就没有它的 [×]，
   *    这里兜住键盘等旁路触发。
   *
   * ⚠️ `shellId` 可能是 `undefined`（标签刚开、`session` 首帧还没回来）。那时后端那个
   *    会话确实还没建成或前端还不知道它叫什么 —— 装配层据此**不发**销毁帧，而不是
   *    发一个空 id 让后端去猜。
   */
  const closeTab = useCallback(
    (sessionId: string): string | undefined => {
      const tab = tabs.find((t) => t.sessionId === sessionId);
      if (tab?.closable !== true) return undefined;
      closeShellTabAction(sandboxId, sessionId);
      if (activeSessionId === sessionId) setActiveSession(sandboxId, agentSessionId);
      return tab.shellId;
    },
    [tabs, sandboxId, activeSessionId, agentSessionId, closeShellTabAction, setActiveSession],
  );

  const adoptShellId = useCallback(
    (sessionId: string, shellId: string): void => {
      adoptShellIdAction(sandboxId, sessionId, shellId);
    },
    [sandboxId, adoptShellIdAction],
  );

  const receiveShellInventory = useCallback(
    (shells: TerminalShellSummary[] | null): void => {
      recordShellInventory(sandboxId, shells);
    },
    [sandboxId, recordShellInventory],
  );

  return {
    tabs,
    activeSessionId,
    mountedSessionIds,
    selectTab,
    openShellTab,
    closeTab,
    launchOptions,
    adoptShellId,
    receiveShellInventory,
    // ⚠️ **缺席 ≠ unavailable**：页面刚打开、清单还没回来时它是 false（界面上什么都不说），
    //    只有后端明说"问不出来"才翻成 true。
    inventoryUnavailable: inventoryState === 'unavailable',
  };
}
