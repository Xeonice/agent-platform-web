// 任务树活跃时间复用 formatTime；无真实时间戳或 lastActiveAt<=0 时返回 undefined。
// 调用方隐藏整段活跃时间，不用估算值或占位日期代替。
import { formatRelativePast } from '@/lib/_shared/formatTime';

export function describeTaskActivity(lastActiveAt: number, now: number): string | undefined {
  if (lastActiveAt <= 0) return undefined;
  const relative = formatRelativePast(new Date(lastActiveAt).toISOString(), now);
  return relative === undefined ? undefined : `活跃于 ${relative}`;
}
