// projects × tasks 派生分组树（15 §5）：hook 取数并调用 lib 纯函数，不建平行结构。
import { useMemo } from 'react';
import { countWaitingInput, selectProjectTaskTree } from '@/lib/project/selectProjectTaskTree';
import { filterProjectGroups } from '@/lib/project/filterTaskTree';
import { describeTaskActivity } from '@/lib/project/taskActivity';
import type { Project, ProjectGroup, Sandbox, TaskStatusFilter } from '@/types/domain';

export interface ProjectTaskTree {
  groups: ProjectGroup[];
  waitingInputCount: number;
  /** query 非空或 status !== 'all'（design-notes.md §4 Phase 3：搜索 + 筛选 chips）。 */
  hasActiveFilter: boolean;
  /**
   * 过滤后一条任务都不剩，且原始树里本来就有任务（区别于"这个人还没建过任务"的空态）。
   * 调用方据此渲染"没有找到匹配的任务"，⛔ 不是把两种空态混成一句话。
   */
  hasNoFilterMatches: boolean;
}

/**
 * views 层禁止 import lib（07 §4.1 boundaries），故 chip 常量搬到这个 hook 里对外重导出。
 * P21-1 §6 六档口径：全部/准备中/运行中/等待输入/已暂停/异常（`'stopped'` 不在其中，
 * 见 `filterTaskTree.ts` 顶部说明）。
 */
export const TASK_STATUS_FILTERS: readonly TaskStatusFilter[] = [
  'all',
  'preparing',
  'running',
  'waitingInput',
  'paused',
  'error',
];

export function useProjectTaskTree(
  projects: Project[],
  tasks: Sandbox[],
  folds: Record<string, boolean>,
  currentProjectId: string | null,
  searchQuery = '',
  statusFilter: TaskStatusFilter = 'all',
): ProjectTaskTree {
  const { groups, hasActiveFilter, hasNoFilterMatches } = useMemo(() => {
    // 「活跃于 X 前」是纯展示派生字段（design-notes.md §4 Phase 3），在这里一次性算好
    // 附到每个任务上——view 层不许 import lib，算晚了没处算。
    const now = Date.now();
    const withActivity = tasks.map((t) => ({
      ...t,
      activityLabel: describeTaskActivity(t.lastActiveAt, now),
    }));
    const tree = selectProjectTaskTree(projects, withActivity, folds, currentProjectId);
    const filtered = filterProjectGroups(tree, { query: searchQuery, status: statusFilter });
    const totalTasks = tree.reduce((sum, g) => sum + g.tasks.length, 0);
    return {
      groups: filtered.groups,
      hasActiveFilter: filtered.hasActiveFilter,
      hasNoFilterMatches:
        filtered.hasActiveFilter && totalTasks > 0 && filtered.matchedTaskCount === 0,
    };
  }, [projects, tasks, folds, currentProjectId, searchQuery, statusFilter]);
  // 计数口径 = 全部项目，不受折叠/搜索/筛选影响（15 §5）。
  const waitingInputCount = useMemo(() => countWaitingInput(tasks), [tasks]);
  return { groups, waitingInputCount, hasActiveFilter, hasNoFilterMatches };
}
