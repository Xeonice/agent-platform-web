// 项目克隆进度投影（10 §7.4 project.clone_progress）：keyed by projectId → 进度/阶段/错误。
// /events 通道驱动；create 202 后种子 cloning。⚠️ 纯内存运行时态，不 persist（未纳入白名单）。
import type { StateCreator } from 'zustand';
import type { SandboxEvent } from '@/types/ws-protocol';
import type { ProjectCloneState } from '@/types/project';

export type { ProjectCloneState };

export interface ProjectCloneSlice {
  projectClones: Record<string, ProjectCloneState>;
  /** 显式种子/写入（create 202 后立即展示 cloning，不等首个事件）。 */
  setCloneProgress: (projectId: string, state: ProjectCloneState) => void;
  /** 应用一条 /events 事件（仅消费 project.clone_progress，其余忽略）。 */
  applyProjectCloneEvent: (event: SandboxEvent) => void;
  /** 移除条目（完成关闭/复位）。 */
  clearCloneProgress: (projectId: string) => void;
}

function omitKey(
  map: Record<string, ProjectCloneState>,
  key: string,
): Record<string, ProjectCloneState> {
  return Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
}

export const createProjectCloneSlice: StateCreator<ProjectCloneSlice, [], [], ProjectCloneSlice> = (
  set,
) => ({
  projectClones: {},
  setCloneProgress: (projectId, state): void => {
    set((s) => ({ projectClones: { ...s.projectClones, [projectId]: state } }));
  },
  applyProjectCloneEvent: (event): void => {
    if (event.event !== 'project.clone_progress') return;
    set((s) => ({
      projectClones: {
        ...s.projectClones,
        [event.projectId]: {
          phase: event.phase,
          percent: event.percent,
          receivedBytes: event.receivedBytes,
          totalBytes: event.totalBytes,
          errorCode: event.errorCode,
        },
      },
    }));
  },
  clearCloneProgress: (projectId): void => {
    set((s) =>
      s.projectClones[projectId] === undefined
        ? s
        : { projectClones: omitKey(s.projectClones, projectId) },
    );
  },
});
