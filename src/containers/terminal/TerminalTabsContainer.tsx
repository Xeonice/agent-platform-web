'use client';
// 终端多标签的装配层（P21-1 §3/§6，08 §5）：标签栏 + N 个常驻的终端实例。
//
// 唯一 view↔hooks 粘合点；本层只做编排，判断全在 `useTerminalSessions` / lib（07 §3）。
//
// ── 这一层最容易被写错的两件事，都写在下面 ────────────────────────────────────
// ① **切换标签不许销毁实例**（08 §5.2）：未选中的挂载点用 `display:none` 藏起来，
//    xterm 实例照样活着。销毁重建会丢 WebGL 上下文，还要"清空→重连→重绘"闪一下。
// ② **被 LRU 淘汰的标签仍然在栏上**（08 §5.3）：`mountedSessionIds` 只决定"谁有实例"，
//    `tabs` 才决定"栏上有谁"。点一下淘汰过的标签 ⇒ 它重新进 mounted ⇒ 静默重建，
//    ⛔ 不提示、不确认（08 §8 第一类场景）。
// ③ **刷新后的恢复走 `shells` 帧**（06 §5.5）：后端在 Agent 那条连接上报回"这个 Task
//    下还活着哪几个用户终端"，标签栏据此**只加不减**地补回来。清单问不出来时
//    （第三态）标签栏就地说"查不到"—— ⛔ 绝不渲染成"没有别的终端"。
import { useCallback, useMemo, useRef } from 'react';
import { TerminalContainer } from '@/containers/terminal/TerminalContainer';
import { TerminalTabBarView } from '@/views/terminal/TerminalTabBar.view';
import { useTerminalSessions } from '@/hooks/terminal/useTerminalSessions';
import { useRuntimes } from '@/hooks/credential/useRuntimes';
import type { TerminalClientFrame, TerminalShellSummary } from '@/types/ws-protocol';
import type { TerminalSocketConfig } from '@/types/terminal';

export interface TerminalTabsContainerProps {
  sandboxId: string;
  /** 基础连接描述（不带 kind/shellId）；每个标签自己的由 hook 派生。 */
  socketConfig: TerminalSocketConfig;
  /**
   * 这个沙箱里能跑哪几个 runtime（`SandboxDto.availableRuntimes`，06 §5.6）。
   * ⛔ 由上层从**沙箱 DTO** 传下来，⛔ 不在这里用 `/api/runtimes` 全集现算。
   */
  availableRuntimes?: readonly string[];
  /**
   * 仪表壳工具栏的面包屑（design-notes.md §4 Phase 3 / 原型 `renderTerminal()`：
   * `${项目名} / ${任务名}`）。**同一个 Task 下的每个标签都用同一句**——它说的是
   * "这个终端属于哪个项目/哪个任务"，不是"这个标签叫什么"（标签名已经由
   * `TerminalTabBarView` 单独顶栏显示，两者不重复）。
   */
  breadcrumb?: string;
}

export function TerminalTabsContainer({
  sandboxId,
  socketConfig,
  availableRuntimes = [],
  breadcrumb,
}: TerminalTabsContainerProps) {
  /**
   * runtimeId → 展示名。⚠️ 只拿**名字**：能开哪几个由沙箱行说了算（上面那个 prop），
   * 这里的列表只负责把 `claude-code` 译成「Claude Code」。
   * 取不到（还在加载 / 请求失败）⇒ 标签回落「终端 N」、下拉回落显示 id，都不阻断。
   */
  const runtimes = useRuntimes();
  const runtimeNames = useMemo(
    () => new Map((runtimes.data ?? []).map((r) => [r.id, r.displayName])),
    [runtimes.data],
  );
  const {
    tabs,
    activeSessionId,
    mountedSessionIds,
    selectTab,
    openShellTab,
    closeTab,
    adoptShellId,
    receiveShellInventory,
    inventoryUnavailable,
    launchOptions,
  } = useTerminalSessions(sandboxId, socketConfig, availableRuntimes, runtimeNames);

  /**
   * 当下还挂着的标签各自的 `send`。
   *
   * ⚠️ 用 ref 而不是 state：它只在"关标签"那一刻被读一次，进 state 会让每次注册都
   * 触发一轮重渲染，而重渲染又会重建回调 → 再注册一次（自喂循环，本域已栽过一次）。
   */
  const senders = useRef(new Map<string, (frame: TerminalClientFrame) => boolean>());

  /**
   * 每个标签**身份稳定**的一对回调。
   *
   * ⚠️ ⛔ 绝不能在渲染里现造（`(id) => (send) => …` 每帧都是新函数）：`registerSend`
   * 进了 `TerminalMount` 里那个 effect 的依赖数组，身份一抖就是"注销 → 重新注册"
   * 每帧跑一遍。这与 08 §7.4 记的那条同源 ——「下游 useCallback 身份抖动 → 连接
   * effect 反复 close+重连」，本域已经为它栽过一次。
   *
   * ⇒ 按 sessionId 缓存一份，只在第一次见到这个标签时造。
   */
  const perTab = useRef(
    new Map<
      string,
      {
        registerSend: (send: ((frame: TerminalClientFrame) => boolean) | null) => void;
        onShellId: (shellId: string) => void;
        onShells: (shells: TerminalShellSummary[] | null) => void;
      }
    >(),
  );

  const adoptShellIdRef = useRef(adoptShellId);
  adoptShellIdRef.current = adoptShellId;
  const receiveShellInventoryRef = useRef(receiveShellInventory);
  receiveShellInventoryRef.current = receiveShellInventory;

  const callbacksFor = useCallback((sessionId: string) => {
    const cached = perTab.current.get(sessionId);
    if (cached !== undefined) return cached;
    const made = {
      registerSend: (send: ((frame: TerminalClientFrame) => boolean) | null): void => {
        if (send === null) senders.current.delete(sessionId);
        else senders.current.set(sessionId, send);
      },
      onShellId: (shellId: string): void => {
        adoptShellIdRef.current(sessionId, shellId);
      },
      onShells: (shells: TerminalShellSummary[] | null): void => {
        receiveShellInventoryRef.current(shells);
      },
    };
    perTab.current.set(sessionId, made);
    return made;
  }, []);

  /**
   * 关标签 = 从栏上去掉 + **销毁后端那个 tmux 会话**。
   *
   * ⛔ 销毁只在这里发生。断连（刷新、抖动、LRU 淘汰）一律只 detach —— 那个标签里
   *    可能正跑着一个长构建。这是 agent 会话那条纪律（裁决 D-15）在用户 shell 上的
   *    同款延伸，后端 `handleDisconnect` 侧也钉了用例。
   *
   * ⚠️ **借一条连接代发**：被关的标签自己可能早被 LRU 淘汰、没有 socket 了。
   *    `close_shell` 帧里带 shellId，所以同一沙箱的任意一条连接都能代发 ——
   *    少了这一手，淘汰过的标签点 [×] 只会让它从界面上消失，而沙箱里那个 tmux 会话
   *    成了看不见也关不掉的孤儿。当前标签**永不被淘汰**（08 §5.3），所以总有一条在。
   *
   * ⚠️ `shellId` 还没回来（标签刚开、首帧未到）⇒ **不发**。发一个空 id 让后端去猜，
   *    比不发更糟。这种情况下后端那个会话多半还没建成；真建成了也会随沙箱一起回收。
   */
  const handleClose = useCallback(
    (sessionId: string): void => {
      const shellId = closeTab(sessionId);
      if (shellId === undefined) return;
      const send = senders.current.get(sessionId) ?? senders.current.get(activeSessionId);
      send?.({ type: 'close_shell', shellId });
    },
    [closeTab, activeSessionId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TerminalTabBarView
        tabs={tabs.map((t) => ({
          sessionId: t.sessionId,
          label: t.label,
          closable: t.closable,
        }))}
        activeSessionId={activeSessionId}
        onSelect={selectTab}
        onClose={handleClose}
        onNewTerminal={openShellTab}
        launchOptions={launchOptions}
        inventoryUnavailable={inventoryUnavailable}
      />
      <div className="relative min-h-0 flex-1">
        {tabs
          .filter((t) => mountedSessionIds.includes(t.sessionId))
          .map((t) => {
            const cb = callbacksFor(t.sessionId);
            return (
              /*
              ⚠️ `display:none` 而不是条件渲染。条件渲染 = 卸载 = `term.dispose()`，
              也就是"每切一次标签就销毁重建一次"—— 08 §5.2 明说不许。
              ⛔ 也不要换成 `visibility:hidden` / `opacity:0`：那些仍然占布局，
              两个终端会互相挤掉高度。
            */
              <div
                key={t.sessionId}
                data-testid={`terminal-pane-${t.sessionId}`}
                className="absolute inset-0"
                style={{ display: t.sessionId === activeSessionId ? 'block' : 'none' }}
              >
                <TerminalContainer
                  sessionId={t.sessionId}
                  sandboxId={sandboxId}
                  socketConfig={t.socketConfig}
                  active={t.sessionId === activeSessionId}
                  onShellId={cb.onShellId}
                  onShells={cb.onShells}
                  registerSend={cb.registerSend}
                  {...(breadcrumb === undefined ? {} : { breadcrumb })}
                />
              </div>
            );
          })}
      </div>
    </div>
  );
}
