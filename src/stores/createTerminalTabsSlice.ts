// 终端**标签**表（08 §5.1 / P21-1 §6）：同一个 Task 下用户自己开的那几个终端。
//
// ── 它为什么不是 `createTerminalRegistrySlice` 的一部分 ──────────────────────────
// registry 是**实例**注册表：一条 entry 必须持有活着的 Terminal + socket 句柄，所以
// 它只在挂载之后才存在、被 LRU 淘汰之后就消失。而标签**必须比实例活得久**：
// 被淘汰的标签仍然要留在标签栏上（点一下静默重建，08 §5.2/§5.3）。
// ⇒ 两张表，各管一件事：这里管「有哪几个标签、哪个在前台、它们各自的后端会话 id」，
//   registry 管「当下哪几个真的有实例」。⛔ 别把它们合并——合并之后"淘汰"就等于
//   "标签消失"，那正是 08 §5.2 明说不许发生的事。
//
// ⛔ **绝不 persist**：`shellId` 是后端会话凭据（与 socketSessionKey 同类，15 §3.5）。
//    刷新之后标签回到只剩 Agent 一个，是**有意的**——见下面 `openShellTab` 的注释。
import type { StateCreator } from 'zustand';

/**
 * 一个用户自己开的终端标签。
 *
 * ⚠️ `sessionId`（前端标签身份）与 `shellId`（后端 tmux 会话 id）是**两个东西**，
 * 与 08 §11.1 对 `sessionId` ≠ `socketSessionKey` 的区分同源：
 *   · `sessionId` 本地生成，标签一建立就有，是 xterm 实例与 registry 的键；
 *   · `shellId` 由**服务端**生成（审计 P2-9），要等 `session` 首帧才知道，
 *     前端只负责记住并带回。⛔ 前端不许自造——它会进后端 `tmux -s` 的 argv。
 */
export interface TerminalShellTab {
  sessionId: string;
  /** `undefined` = 首帧还没回来（这个标签的会话后端还没告诉我们叫什么）。 */
  shellId?: string;
  /**
   * 这个标签里跑的是哪个 agent CLI（06 §5.6）。**缺席 = 纯终端**（`$SHELL`）。
   *
   * ⛔ 缺席不许被当成"沙箱的默认 runtime"：那会让一个纯终端标签顶着「Codex」的名字，
   * 而用户点它是想要一个 shell。
   */
  runtimeId?: string;
}

export interface TerminalTabsSlice {
  /** sandboxId → 用户自己开的标签（**不含** Agent 那个，见下）。顺序即标签顺序。 */
  shellTabsOf: Map<string, TerminalShellTab[]>;
  /**
   * sessionId → 最近一次被激活的**序号**，LRU 用（08 §5.3：只在真正激活时更新，
   * ⛔ 不在每次 `write()` 时更新——否则一个刷屏的后台标签会把自己顶成"最近使用"，
   * 挤掉用户真正在看的那个）。
   *
   * ⚠️ 用自增序号而不是 `Date.now()`：同一毫秒内连开两个标签会撞成相同时间戳，
   * 于是 LRU 的顺序退化成 Map 的插入顺序——那时"最久未用"可能淘汰掉刚开的那个。
   * 序号严格单调，没有这种并列。
   */
  tabActivatedAt: Map<string, number>;
  /** 上面那个序号的发号器。 */
  tabActivationTick: number;
  /** 每个 sandbox 已经发过几个标签号——用于 sessionId 与「终端 N」的命名，只增不减。 */
  shellTabSeqOf: Map<string, number>;
  /**
   * 新开一个用户终端标签，返回它的 sessionId。
   * `runtimeId` 省略 = 纯终端；给了 = 在里面跑那个 agent CLI（06 §5.6）。
   */
  openShellTab: (sandboxId: string, runtimeId?: string) => string;
  /** 关掉一个用户终端标签（只动本表；销毁后端会话由 container 发 `close_shell`）。 */
  closeShellTab: (sandboxId: string, sessionId: string) => void;
  /**
   * 后端说「这个 Task 下还有这些用户终端」（06 §5.5 的 `shells` 帧）。
   * `shells === null` = **问不出来**（三态的第三态），此时只记状态、一个标签都不动。
   */
  recordShellInventory: (
    sandboxId: string,
    shells: { shellId: string; runtimeId?: string }[] | null,
  ) => void;
  /**
   * sandboxId → 上一次清单的结果。`'ok'` = 问到了（可能是空）；`'unavailable'` = 问不出来；
   * **缺席** = 还没问到（页面刚打开的那一瞬）。三者在界面上不是同一句话。
   */
  shellInventoryOf: Map<string, 'ok' | 'unavailable'>;
  /** 记下后端为这个标签分配的 tmux 会话 id（`session` 首帧到达时）。 */
  adoptShellId: (sandboxId: string, sessionId: string, shellId: string) => void;
  /** 标记「这个标签刚被激活」——LRU 的唯一输入。 */
  markTabActivated: (sessionId: string) => void;
}

/**
 * Agent 标签**不进这张表**，它由 sandboxId 直接派生（`agentSessionIdOf`）。
 *
 * ⛔ 这不是省事：存进表里就意味着它可以被 `closeShellTab` 删掉、可以因为一次状态
 * 迁移而丢失。而 Agent 那个会话是**任务本身**（裁决 D-15），界面上必须永远有它、
 * 且永远不给 [×]。让它压根不在这张可增删的表里，是最省心的保证。
 *
 * ⚠️ 保留 `:0` 这个既有形状（S1 起就是它），改名会让既有用例与 registry 里的键漂移。
 */
export function agentSessionIdOf(sandboxId: string): string {
  return `${sandboxId}:0`;
}

export const createTerminalTabsSlice: StateCreator<TerminalTabsSlice, [], [], TerminalTabsSlice> = (
  set,
  get,
) => ({
  shellTabsOf: new Map(),
  tabActivatedAt: new Map(),
  tabActivationTick: 0,
  shellTabSeqOf: new Map(),
  shellInventoryOf: new Map(),

  /**
   * [+ 新终端]。
   *
   * ⚠️ 序号**只增不减**（`shellTabSeqOf`）：关掉「终端 2」再新建，下一个是「终端 3」
   * 而不是又一个「终端 2」。复用序号会让刚关掉的标签和新开的标签同名，而它们背后
   * 是两个不同的 tmux 会话——用户按名字回忆"我刚才在哪个窗口跑的构建"时会认错。
   */
  openShellTab: (sandboxId, runtimeId): string => {
    const seq = (get().shellTabSeqOf.get(sandboxId) ?? 0) + 1;
    const sessionId = `${sandboxId}:shell:${String(seq)}`;
    set((s) => {
      const shellTabsOf = new Map(s.shellTabsOf);
      shellTabsOf.set(sandboxId, [
        ...(shellTabsOf.get(sandboxId) ?? []),
        // ⚠️ `undefined` 不写进去（exactOptionalPropertyTypes）：缺席就是"纯终端"。
        runtimeId === undefined ? { sessionId } : { sessionId, runtimeId },
      ]);
      const shellTabSeqOf = new Map(s.shellTabSeqOf);
      shellTabSeqOf.set(sandboxId, seq);
      const tabActivationTick = s.tabActivationTick + 1;
      const tabActivatedAt = new Map(s.tabActivatedAt);
      tabActivatedAt.set(sessionId, tabActivationTick);
      return { shellTabsOf, shellTabSeqOf, tabActivatedAt, tabActivationTick };
    });
    return sessionId;
  },

  closeShellTab: (sandboxId, sessionId): void => {
    set((s) => {
      const rest = (s.shellTabsOf.get(sandboxId) ?? []).filter((t) => t.sessionId !== sessionId);
      const shellTabsOf = new Map(s.shellTabsOf);
      if (rest.length > 0) shellTabsOf.set(sandboxId, rest);
      else shellTabsOf.delete(sandboxId);
      const tabActivatedAt = new Map(s.tabActivatedAt);
      tabActivatedAt.delete(sessionId);
      return { shellTabsOf, tabActivatedAt };
    });
  },

  adoptShellId: (sandboxId, sessionId, shellId): void => {
    set((s) => {
      const tabs = s.shellTabsOf.get(sandboxId);
      if (tabs === undefined) return {};
      const i = tabs.findIndex((t) => t.sessionId === sessionId);
      if (i === -1 || tabs[i]?.shellId === shellId) return {};
      /**
       * ⭐ **同一个 shellId 只许有一个标签**。
       *
       * 这条挡的是一个很窄但真实的竞态：页面刚加载、清单（`shells` 帧）还在路上时，
       * 用户点了 [+ 新终端] ⇒ 后端建了会话 X，而清单恰好也把 X 带了回来。那一刻前端
       * 还不知道自己那个标签就是 X（`session` 首帧没到），于是清单会**再开一个**标签。
       * 两个标签背后是同一个 tmux 会话 = 同一块屏幕的镜像 —— 正是多标签这件事要消灭的
       * 那个现象。
       *
       * ⚠️ 这**不是**「按服务端清单删标签」（那条明令禁止，见 `recordShellInventory`）：
       * 依据是**身份撞了**（两个标签证明自己是同一个会话），不是"服务端没报它"。
       * 留下正在连着的这一个（`sessionId`），扔掉那个从清单补进来的空壳。
       */
      const next = tabs.filter((t) => t.shellId !== shellId || t.sessionId === sessionId);
      const j = next.findIndex((t) => t.sessionId === sessionId);
      const mine = next[j];
      if (j === -1 || mine === undefined) return {};
      // ⚠️ **保住 runtimeId**：这个标签是不是一个 CLI 标签，是它建的时候就定了的事。
      //    首帧只带回 shellId，整条替换会把「我是 Codex 标签」这件事抹掉。
      next[j] =
        mine.runtimeId === undefined
          ? { sessionId, shellId }
          : { sessionId, shellId, runtimeId: mine.runtimeId };
      const shellTabsOf = new Map(s.shellTabsOf);
      shellTabsOf.set(sandboxId, next);
      return { shellTabsOf };
    });
  },

  /**
   * 把后端清单并进标签表。
   *
   * ⛔ **只加不减，永不据此删除**。清单会在每一次 Agent 连接（含重连）之后再来一次，
   * 而一个刚点了 [+ 新终端]、`session` 首帧还没回来的标签**不在服务端清单里**（后端
   * 那一刻可能还没建完会话，或者建完了但前端还没拿到 id）。拿清单做全量 reconcile
   * 就会把它当成"服务端没有"抹掉 —— 用户眼睁睁看着自己刚开的终端消失。
   *
   * ⚠️ **顺序是载荷的一部分**：清单按 tmux `session_created` 升序，这里按同样的顺序
   * 补进去，于是「终端 1..n」跟着创建顺序走。⇒ 刷新后编号可能**位移**（刷新前
   * 「终端 1 / 终端 3」→ 刷新后「终端 1 / 终端 2」）。这是**已知代价不是 bug**：
   * 序号不 persist（它藏在 sessionId 里），而唯一能跨刷新稳定的事实只有创建顺序；
   * 要不位移就得把 `shellId → 序号` 存进 localStorage，而 `shellId` 是会话凭据，
   * 15 §3.5 明令不许落盘。
   *
   * `shells === null`（问不出来）⇒ 只记状态，**一个标签都不动**：既不补也不删。
   */
  recordShellInventory: (sandboxId, shells): void => {
    set((s) => {
      const shellInventoryOf = new Map(s.shellInventoryOf);
      shellInventoryOf.set(sandboxId, shells === null ? 'unavailable' : 'ok');
      if (shells === null) return { shellInventoryOf };

      const existing = s.shellTabsOf.get(sandboxId) ?? [];
      const known = new Set(existing.map((t) => t.shellId).filter((v) => v !== undefined));
      const missing = shells.filter((entry) => !known.has(entry.shellId));
      if (missing.length === 0) return { shellInventoryOf };

      let seq = s.shellTabSeqOf.get(sandboxId) ?? 0;
      const added = missing.map(({ shellId, runtimeId }) => {
        seq += 1;
        const sessionId = `${sandboxId}:shell:${String(seq)}`;
        // ⚠️ runtimeId 跟着清单回来 —— 刷新之后一个正跑着 Claude Code 的标签才不会
        //    显示成「终端 2」。读不到（老 tmux）⇒ 缺席 ⇒ 回落「终端 N」，不更坏。
        return runtimeId === undefined ? { sessionId, shellId } : { sessionId, shellId, runtimeId };
      });
      const shellTabsOf = new Map(s.shellTabsOf);
      shellTabsOf.set(sandboxId, [...existing, ...added]);
      const shellTabSeqOf = new Map(s.shellTabSeqOf);
      shellTabSeqOf.set(sandboxId, seq);
      // ⛔ **不给恢复出来的标签发激活记录**，也不切过去：它们是"用户之前开过的"，
      //    不是"用户刚刚点的"。给了记录就会在 LRU 里压过真正在用的标签。
      return { shellTabsOf, shellTabSeqOf, shellInventoryOf };
    });
  },

  markTabActivated: (sessionId): void => {
    set((s) => {
      const tabActivationTick = s.tabActivationTick + 1;
      const tabActivatedAt = new Map(s.tabActivatedAt);
      tabActivatedAt.set(sessionId, tabActivationTick);
      return { tabActivatedAt, tabActivationTick };
    });
  },
});
