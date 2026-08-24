// 项目领域类型：REST 形状一律来自后端生成物（generate:api → openapi.d.ts），杜绝手写漂移。
// 关键：cloneStatus 由生成物强制为 'cloning'|'ready'|'failed'（不是 'ok'）。
import type { components } from '@/types/generated/openapi';

/**
 * 后端项目 DTO（生成物）。含基线四字段 `repoUrl`/`repoBranch`/`baselineSizeBytes`/`updatedAt`
 * —— 它们本轮才进 DTO，此前一直卡在持久化层（10 §7 那条「repoUrl 不入 DTO」旧定案已被
 * F21-6 §9.1 推翻）。注意 `updatedAt` 在契约里是**必填**。
 */
export type ProjectDto = components['schemas']['ProjectResponseDto'];
/** 新建项目请求体（生成物；git 需 repoUrl，`repoBranch` 契约里一直有，本轮表单才接上）。 */
export type CreateProjectInput = components['schemas']['CreateProjectDto'];

export type ProjectSourceType = ProjectDto['sourceType'];
/** 'cloning' | 'ready' | 'failed'（生成物强制，防漂移）。 */
export type ProjectCloneStatus = ProjectDto['cloneStatus'];
/** 后端已知 cloneErrorCode（生成物 enum；null 表示无错误）。 */
export type CloneErrorCode = NonNullable<ProjectDto['cloneErrorCode']>;

// —— clone_progress 事件投影（走 ws-protocol 的 zod，不走 openapi；放 types/ 供 store/lib/hook/view 共享）——
export type CloneProgressPhase = 'cloning' | 'slow' | 'done' | 'failed';

/** git 自己 announce 的阶段（03 §7.2★）。 */
export type CloneStage =
  'enumerating' | 'counting' | 'compressing' | 'receiving' | 'resolving' | 'checkout';

export interface ProjectCloneState {
  phase: CloneProgressPhase;
  /** git 阶段；填住 receiving 开始前那段空窗（实测 3.4s 起，慢远端更久）。 */
  stage?: CloneStage;
  percent?: number;
  /** `(527/26348)` —— 真分母。 */
  objectsDone?: number;
  objectsTotal?: number;
  receivedBytes?: number;
  /** 接收速率；卡住时先归零，比百分比停住更早暴露。 */
  bytesPerSecond?: number;
  errorCode?: string;
  /** 本地记的起始时刻（epoch ms），用于"已用 x:xx"。不来自后端。 */
  startedAt?: number;
}

// ⚠️ 这里曾有 `totalBytes?`，2026-08 删除：git clone 不报总字节数，后端从未发过它，
// 而 buildDetailLabel 有一条 `receivedBytes && totalBytes` 的分支在等它——生产永远
// 走不到，却有一条手工构造 state 的测试把它测成绿的。分母改用 objectsTotal。
