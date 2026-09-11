// 终端标签的纯逻辑（08 §5.2/§5.3）：LRU 该留下谁、标签叫什么。
// 放 lib 是因为这两件事都是**不带 React 的判断**，必须能单测到（07 §3 规则 2）。

/**
 * 同时活着的 Terminal 实例上限（08 §5.2「默认 4–6」，审计 P2-11）。
 *
 * ── 为什么是个位数，而不是 8–10 ──────────────────────────────────────────────
 * 每个启用 WebGL renderer 的 Terminal 各占一个 **WebGL 上下文**，而浏览器对同源页面
 * 的并发上下文数有硬上限（Chrome/Safari 量级 8–16）。**接近上限时最早的上下文会被
 * 浏览器主动回收** —— 表现为"切回某个旧终端，画面是黑的/花的，而且没有任何报错"。
 * 压到 4–6 是给上下文预算留余量，代价只是多一次 tmux re-attach（几百毫秒，静默）。
 *
 * ⏳ **还没做的一半**：08 §5.2 还写了「降级到 canvas renderer 时可放宽到 8–10」。
 * 那要按**实际** renderer 动态取值（`useTerminalInstance.getRenderer`），而 renderer
 * 要等实例建出来才知道 —— 也就是说上限要在"已经建了"之后才算得出来。本轮先用一个
 * 常量，把放宽记为已知缺口，⛔ 不要把它写死在别处（那会变成第二个知情者）。
 */
export const TERMINAL_INSTANCE_LIMIT = 6;

/**
 * 这一刻该保留哪几个 Terminal 实例（其余的标签仍在栏上，只是没有实例）。
 *
 * 两条纪律（08 §5.3）都在这里：
 *   ① **活跃会话永不淘汰** —— `activeSessionId` 无条件入选。否则在上限边缘会出现
 *      "刚切过去就被自己挤掉"。
 *   ② 淘汰顺序按最近激活序号，最久未激活的先出局。
 *
 * ⚠️ 返回值**保持 `order` 的顺序**，不是按激活序号排。调用方拿它去渲染，顺序一抖
 * React 就会把 DOM 搬来搬去，而终端实例挂在那些 DOM 上。
 */
export function selectMountedSessions(
  order: readonly string[],
  activatedAt: ReadonlyMap<string, number>,
  activeSessionId: string,
  limit: number = TERMINAL_INSTANCE_LIMIT,
): string[] {
  if (order.length <= limit) return [...order];
  const keep = new Set<string>([activeSessionId]);
  const rest = order
    .filter((id) => id !== activeSessionId)
    .sort((a, b) => (activatedAt.get(b) ?? 0) - (activatedAt.get(a) ?? 0));
  for (const id of rest) {
    if (keep.size >= limit) break;
    keep.add(id);
  }
  return order.filter((id) => keep.has(id));
}

/**
 * Agent 标签的名字。
 *
 * ⚠️ 它**不叫「终端 1」**。这个标签背后是 Task 自己的那个会话（后端在启动实例时就起好
 * 并开始执行，裁决 D-15）——它与用户自己开的终端是两类东西：关不掉、里面跑的是 Agent。
 * 叫成「终端 1」会把这个区别抹掉，用户会以为它跟旁边几个一样可以随手关。
 *
 * ⚠️ 术语按 P21-1 §9：runtime 一律叫 **Agent**。
 */
export const AGENT_TAB_LABEL = 'Agent';

/**
 * 用户自己开的第 n 个标签叫什么（n 取自标签序号，只增不减）。
 *
 * ⚠️ **名字要说清里面跑的是什么**（06 §5.6）：一个 Codex 沙箱里，「Agent」标签和用户
 * 自己开的「Codex 2」跑的是**同一个 CLI**，但前者是任务本身（关不掉）、后者是随手开的
 * （可关）。只靠序号区分不了，所以带上 CLI 的名字。
 *
 * @param displayName runtime 的展示名（`GET /api/runtimes` 给的）；`undefined` = 纯终端。
 *   ⚠️ 拿不到展示名时**回落到「终端 N」而不是 runtime id**：`claude-code 2` 这种
 *   半生不熟的名字比诚实的「终端 2」更糟 —— 它看起来像个 bug。
 */
export function shellTabLabel(seq: number, displayName?: string): string {
  return displayName === undefined || displayName === ''
    ? `终端 ${String(seq)}`
    : `${displayName} ${String(seq)}`;
}

/**
 * 从 sessionId 反取标签序号（`<sandboxId>:shell:<n>`）。
 *
 * ⚠️ 序号存在 sessionId 里而不是另存一个字段：两份就会有不一致的那一天，而这个值
 * 除了显示没有别的用途。取不到时回 0 ⇒ 「终端 0」，一个明显不对劲的名字 ——
 * ⛔ 不要改成"回一个看起来正常的 1"：那会把 id 形状漂移伪装成正常显示。
 */
export function shellTabSeqOf(sessionId: string): number {
  const n = Number(sessionId.slice(sessionId.lastIndexOf(':') + 1));
  return Number.isInteger(n) && n > 0 ? n : 0;
}
