'use client';
// 「新建任务」深链的挂载点（F21-2 §2.1）。**不渲染任何东西**——它存在只是为了给
// `useNewTaskDeepLink()` 一个位置，而那个位置必须在「项目已选中」**之上**。
//
// ⚠️ 为什么不挂在 `SandboxTerminalContainer` 里（文档 §2.1「读初值」那行原本是这么写的）：
// 那个容器由 `WorkbenchContainer` 在 `selectedProject !== null && selectedReady` 时才渲染，
// 而深链要做的第一件事恰恰是**把 `?project=<id>` 变成选中项目**。收到链接的人本地
// `selectedProjectId` 是 null（或指向别的项目）⇒ 容器不挂载 ⇒ 写在容器里的读初值一次都
// 跑不到，`/?new=1&project=X` 直接访问就是一片工作台常态。落点因此上移一层，文档已回填。
//
// URL 同步（弹窗开/关 ⇄ query）跟着一起放在这里：它只订阅 store 上的 `currentModal` 与
// `selectedProjectId`，不需要弹层的任何局部态，两半放在一处比拆到两个文件更好读。
import { useNewTaskDeepLink } from '@/hooks/_shared/useDeepLinkModal';

export function NewTaskDeepLinkContainer(): null {
  useNewTaskDeepLink();
  return null;
}
