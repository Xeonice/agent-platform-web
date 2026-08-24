// 吊销确认——受影响的运行中 Task 派生（F21-3 §5/§7.1，可单测）。零副作用。
// 按 runtime 过滤运行中 Task；>10 条时返回前 10 + restCount（「最多 10 条 +『等共 N 个』」，P21-3 §6）。
// 视图模型类型落在 types/（view 禁依赖 lib），此处 re-export 便于 lib/hook 就近引用。
import type {
  AffectedTaskInput,
  AffectedTaskItem,
  AffectedTasksResult,
} from '@/types/runtimeCredential';

export type { AffectedTaskInput, AffectedTaskItem, AffectedTasksResult };

const RUNNING_STATUSES = new Set(['running', 'starting', 'pending', 'waiting_input']);
const MAX_LISTED = 10;

/** 某 runtime 被吊销后受影响（强制重启）的运行中 Task 清单。 */
export function affectedRunningTasks(
  tasks: AffectedTaskInput[],
  runtime: string,
): AffectedTasksResult {
  const matched = tasks.filter((t) => t.runtime === runtime && RUNNING_STATUSES.has(t.status));
  const items = matched.slice(0, MAX_LISTED).map((t) => ({ id: t.id, name: t.name }));
  return {
    items,
    restCount: Math.max(0, matched.length - MAX_LISTED),
    total: matched.length,
  };
}
