// projects × tasks 派生分组树（15 §5）：hook 取数并调用 lib 纯函数，不建平行结构。
import { useMemo } from 'react';
import { countWaitingInput, selectProjectTaskTree } from '@/lib/project/selectProjectTaskTree';
import type { Project, ProjectGroup, Sandbox } from '@/types/domain';

export interface ProjectTaskTree {
  groups: ProjectGroup[];
  waitingInputCount: number;
}

export function useProjectTaskTree(
  projects: Project[],
  tasks: Sandbox[],
  folds: Record<string, boolean>,
  currentProjectId: string | null,
): ProjectTaskTree {
  const groups = useMemo(
    () => selectProjectTaskTree(projects, tasks, folds, currentProjectId),
    [projects, tasks, folds, currentProjectId],
  );
  // 计数口径 = 全部项目，不受折叠影响（15 §5）。
  const waitingInputCount = useMemo(() => countWaitingInput(tasks), [tasks]);
  return { groups, waitingInputCount };
}
