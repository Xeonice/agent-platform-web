// 「右侧终端该显示哪个沙箱」的判定 —— 纯逻辑在 lib，本 hook 只是 container 够得着它的那条路
// （container 不能直接 import lib，boundaries §3）。
import { activeSandbox } from '@/lib/sandbox/activeSandbox';
import type { ActiveSandboxDecision, CreatedTaskLike } from '@/lib/sandbox/activeSandbox';

export function useActiveSandbox<T extends CreatedTaskLike>(
  selectedId: string | null,
  createdTask: T | null,
): ActiveSandboxDecision<T> {
  // ⚠️ 无副作用、无状态：判定是纯的，这里不 memo —— 返回值只被解构成两个标量/引用，
  //    每帧新建一个对象不会触发任何下游重算（下游 memo 的 key 是 `restoreId` / `localTask.id`）。
  return activeSandbox({ selectedId, createdTask });
}
