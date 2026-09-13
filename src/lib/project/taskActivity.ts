// 任务树副行「活跃于 X 前」的格式化（design-notes.md §4 Phase 3 第 2 条 / 原型
// `renderTaskTree()` 里的 `活跃于 ${t.active}`）。纯函数，复用相对时间的唯一实现点
// （`@/lib/_shared/formatTime`），不另起一套"三分钟前"的算法。
//
// ⚠️ **`lastActiveAt <= 0` 视为「没有真实时间戳」，返回 `undefined`。**
// `useSandboxes`（10 §7.3 附近的映射层）今天把它硬编码成 `0`——`SandboxDto` 还不带
// 时间戳字段（见该文件注释里的 backlog）。在后端真的把这个字段接上契约之前，
// 显示"活跃于 1970 年前"或拿别的什么估算值顶替，都是编造数据（本轮硬要求：
// 拿不到就不显示这一项）。调用方据此整段不渲染，不是渲染一个占位符。
import { formatRelativePast } from '@/lib/_shared/formatTime';

export function describeTaskActivity(lastActiveAt: number, now: number): string | undefined {
  if (lastActiveAt <= 0) return undefined;
  const relative = formatRelativePast(new Date(lastActiveAt).toISOString(), now);
  return relative === undefined ? undefined : `活跃于 ${relative}`;
}
