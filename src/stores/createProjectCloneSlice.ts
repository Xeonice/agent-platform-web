// 项目克隆进度投影（10 §7.4 project.clone_progress）：keyed by projectId → 进度/阶段/错误。
// /events 通道驱动；create 202 后种子 cloning。⚠️ 纯内存运行时态，不 persist（未纳入白名单）。
import type { StateCreator } from 'zustand';
import type { SandboxEvent } from '@/types/ws-protocol';
import type { ProjectCloneState } from '@/types/project';

export type { ProjectCloneState };

export interface ProjectCloneSlice {
  projectClones: Record<string, ProjectCloneState>;
  /** 显式写入；重试允许从终态重新开始 cloning。 */
  setCloneProgress: (projectId: string, state: ProjectCloneState) => void;
  /** 创建受理种子仅填空，不覆盖先到的克隆事件或列表快照。 */
  seedCloneProgress: (projectId: string, state: ProjectCloneState) => void;
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
  seedCloneProgress: (projectId, state): void => {
    set((s) =>
      s.projectClones[projectId] === undefined
        ? { projectClones: { ...s.projectClones, [projectId]: state } }
        : s,
    );
  },
  applyProjectCloneEvent: (event): void => {
    if (event.event !== 'project.clone_progress') return;
    set((s) => ({
      projectClones: {
        ...s.projectClones,
        [event.projectId]: {
          phase:
            event.phase === 'cloning' && s.projectClones[event.projectId]?.phase === 'slow'
              ? 'slow'
              : event.phase,
          stage: event.stage,
          percent: event.percent,
          objectsDone: event.objectsDone,
          objectsTotal: event.objectsTotal,
          receivedBytes: event.receivedBytes,
          bytesPerSecond: event.bytesPerSecond,
          errorCode: event.errorCode,
          // 起始时刻只认第一次：后续事件不得把它重置，否则"已用"会一直归零。
          startedAt:
            event.startedAt !== undefined && Number.isFinite(Date.parse(event.startedAt))
              ? Date.parse(event.startedAt)
              : s.projectClones[event.projectId]?.startedAt,
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
