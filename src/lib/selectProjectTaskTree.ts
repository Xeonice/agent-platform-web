// 分组任务树派生（15 §5）：纯函数，输入 projects × tasks × folds，输出 ProjectGroup[]。bun/vitest 主战场。
import type { Project, ProjectGroup, Sandbox } from '@/types/domain';

const ORPHAN_GROUP_ID = '__ungrouped__';

/**
 * 把全量 Task 按项目分组为渲染用的 ProjectGroup[]（15 §5 规则）：
 * - 数据源是两个 Query 的结果 + folds，绝不写回 store；
 * - 组内按 lastActiveAt 倒序，组间以 projects 顺序为准、currentProjectId 置顶；
 * - projectId 找不到的孤儿 Task 归入「未分组」组并保持可见，绝不静默丢弃；
 * - 折叠只影响渲染（collapsed 标记），不改变分组集合。
 */
export function selectProjectTaskTree(
  projects: Project[],
  tasks: Sandbox[],
  folds: Record<string, boolean>,
  currentProjectId?: string | null,
): ProjectGroup[] {
  const tasksByProject = new Map<string, Sandbox[]>();
  for (const task of tasks) {
    const key = projects.some((p) => p.id === task.projectId) ? task.projectId : ORPHAN_GROUP_ID;
    const bucket = tasksByProject.get(key);
    if (bucket) bucket.push(task);
    else tasksByProject.set(key, [task]);
  }

  const byActiveDesc = (a: Sandbox, b: Sandbox): number => b.lastActiveAt - a.lastActiveAt;

  const groups: ProjectGroup[] = projects.map((project) => ({
    projectId: project.id,
    projectName: project.name,
    cloneStatus: project.cloneStatus,
    collapsed: folds[project.id] ?? false,
    tasks: (tasksByProject.get(project.id) ?? []).slice().sort(byActiveDesc),
  }));

  const orphanTasks = tasksByProject.get(ORPHAN_GROUP_ID);
  if (orphanTasks && orphanTasks.length > 0) {
    groups.push({
      projectId: ORPHAN_GROUP_ID,
      projectName: '未分组',
      cloneStatus: undefined,
      collapsed: folds[ORPHAN_GROUP_ID] ?? false,
      tasks: orphanTasks.slice().sort(byActiveDesc),
    });
  }

  if (currentProjectId) {
    const idx = groups.findIndex((g) => g.projectId === currentProjectId);
    if (idx > 0) {
      const [current] = groups.splice(idx, 1);
      if (current) groups.unshift(current);
    }
  }

  return groups;
}

/**
 * 「⚡ N 个任务等待你输入」跨全部项目汇总（15 §5）。
 * waitingInput 是 running 的派生子字段，计数只看该字段；折叠不影响计数。
 */
export function countWaitingInput(tasks: Sandbox[]): number {
  return tasks.filter((t) => t.waitingInput).length;
}
