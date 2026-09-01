// 某项目下正在运行的 Task 数（F21-6 §10.6 第 3 条：删除确认里的警示必须读真数据）。
//
// 走的是**工作台左侧树同一份** `GET /api/sandboxes` 缓存（`useSandboxes`），
// 因此打开项目菜单不会多打一次请求，数字也与树上看到的一致。
// container 不得 import lib（07 §4.1 boundaries），判定收在这里。
import { useMemo } from 'react';
import { useSandboxes } from '@/hooks/sandbox/useSandboxes';
import { countRunningTasks } from '@/lib/project/projectDeletion';

export function useProjectRunningTasks(projectId: string | null): number {
  const sandboxes = useSandboxes();
  const tasks = sandboxes.data;
  return useMemo(() => countRunningTasks(tasks ?? [], projectId), [tasks, projectId]);
}
