// 项目领域类型：REST 形状一律来自后端生成物（generate:api → openapi.d.ts），杜绝手写漂移。
// 关键：cloneStatus 由生成物强制为 'cloning'|'ready'|'failed'（不是 'ok'）；ProjectResponseDto 不含 repoUrl（产品红线）。
// repoUrl 仅出现在 CreateProjectDto 请求体，从不回读、不落地。
import type { components } from '@/types/generated/openapi';

/** 后端项目 DTO（生成物；含 cloneStatus:'ready' 就绪态）。 */
export type ProjectDto = components['schemas']['ProjectResponseDto'];
/** 新建项目请求体（生成物；git 需 repoUrl，empty 不需）。 */
export type CreateProjectInput = components['schemas']['CreateProjectDto'];

export type ProjectSourceType = ProjectDto['sourceType'];
/** 'cloning' | 'ready' | 'failed'（生成物强制，防漂移）。 */
export type ProjectCloneStatus = ProjectDto['cloneStatus'];
/** 后端已知 cloneErrorCode（生成物 enum；null 表示无错误）。 */
export type CloneErrorCode = NonNullable<ProjectDto['cloneErrorCode']>;

// —— clone_progress 事件投影（走 ws-protocol 的 zod，不走 openapi；放 types/ 供 store/lib/hook/view 共享）——
export type CloneProgressPhase = 'cloning' | 'slow' | 'done' | 'failed';

export interface ProjectCloneState {
  phase: CloneProgressPhase;
  percent?: number;
  receivedBytes?: number;
  totalBytes?: number;
  errorCode?: string;
}
