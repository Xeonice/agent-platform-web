/**
 * 「右侧终端该显示哪个沙箱」—— 这一条判定，抽成纯函数单独测。
 *
 * ── 它修的是什么：同时开两个任务，切换时右侧完全不变（2026-09-09 真机）──────
 * 此前判定写在容器里，形状是「本会话创建的 task 压过选中态」：
 *
 *   restoreId = task === null ? selectedId : null
 *   sandboxId = task?.id ?? …
 *
 * ⇒ 一旦本会话创建过任务，`task` 就非空，`sandboxId` 永远等于**最后创建的那一个**。
 * 而左侧列表的 `onSelectTask` 只写 store 里的 `selectedSandboxId`，压根到不了这里：
 * `sandboxId` 不变 ⇒ `sessionId` 不变 ⇒ WS 不重连、xterm 实例不换 ⇒ **右侧一个字都不变**。
 *
 * ⚠️ 界面上没有任何报错 —— 它看起来只是「没反应」，最难联想到「选中态被本地状态盖住了」。
 *
 * ⇒ **选中态是唯一真相源**。`task` 退回它本来的职责：为刚创建的那个免掉一次 DTO 往返。
 */
export interface CreatedTaskLike {
  id: string;
}

export interface ActiveSandboxInput<T extends CreatedTaskLike> {
  /** store 里的选中位（persist 白名单字段，刷新后还在）。 */
  selectedId: string | null;
  /** 本会话创建响应带回来的那个任务；与选中态无关地一直留在内存里。 */
  createdTask: T | null;
}

export interface ActiveSandboxDecision<T extends CreatedTaskLike> {
  /** 采用本地创建响应的那份附加信息（名字/runtime/provider/headless）；否则 null ⇒ 走 restore。 */
  localTask: T | null;
  /** 要不要为它发一次 DTO 请求，发哪个 id。 */
  restoreId: string | null;
}

export function activeSandbox<T extends CreatedTaskLike>({
  selectedId,
  createdTask,
}: ActiveSandboxInput<T>): ActiveSandboxDecision<T> {
  // ⛔ **只有「它就是当前选中那个」时才采用本地那份** —— 这一个条件就是整个修复。
  const localTask = createdTask !== null && createdTask.id === selectedId ? createdTask : null;
  return { localTask, restoreId: localTask === null ? selectedId : null };
}
