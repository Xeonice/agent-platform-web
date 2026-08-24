// 沙箱 REST（07 §2）：唯一 fetch 层。类型全部来自生成物（CreateSandboxDto / SandboxResponseDto），前端不手写。
import { apiClient } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import type { components } from '@/types/generated/openapi';
import type { SandboxDto } from '@/types/sandbox';

/**
 * 建沙箱请求体。
 *

/** 新建沙箱请求体（生成物）。`branch` 本轮新增：不选则**不带该字段**，由后端走基线缺省。 */
export type CreateSandboxInput = components['schemas']['CreateSandboxDto'];
/**
 * 沙箱（Task）响应。三个与 S5 相关的字段全部来自生成物，**前端不手写、不派生**：
 *  · `name`（required）—— 后端在创建时从 initialPrompt 派生的默认任务名（10 §7.3，规则 P21-1 §9）。
 *    前端刷新后手里没有 prompt（DTO 刻意不回显），本就算不出来，故一律直接用它。
 *  · `failureCode?` —— **错误码闭集**（04 §4；无码错误兜底 INTERNAL），仅 `status:'failed'` 时出现。
 *  · `failureMessage?` —— **纯自由文本细节**，排障用。⚠️ 码已与文本拆成两列，
 *    **不要从 message 里 parse 码**；人话一律按 failureCode 查 P22 §1。
 * DTO 带这两个字段 ⇒ **刷新后仍能恢复失败原因**（WS 帧错过了就没了，这条才是救命稻草）。
 *
 * 别名住在 `types/sandbox.ts`（`SandboxDto`），因为 mocks/ 也要用同一个形状而 boundaries 只让它 import type。
 */
export type SandboxResponse = SandboxDto;

/** POST /api/sandboxes → 201 SandboxResponseDto（含 id + 默认任务名）。 */
export async function createSandbox(input: CreateSandboxInput): Promise<SandboxResponse> {
  const { data, error, response } = await apiClient.POST('/api/sandboxes', { body: input });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** GET /api/sandboxes/{id} → SandboxResponseDto（刷新后恢复任务名与失败原因的唯一来源）。 */
export async function getSandbox(id: string): Promise<SandboxResponse> {
  const { data, error, response } = await apiClient.GET('/api/sandboxes/{id}', {
    params: { path: { id } },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/**
 * GET /api/sandboxes → 全部项目的 sandbox（`projectId` 可选过滤，10 §6）。
 *
 * ⚠️ 不传 `projectId` 是**有意的**：工作台左侧树要一次拿到所有项目的任务。
 * 后端此前对"不带过滤"直接回空数组，同批已修——契约里 `projectId` 也是这次才补进
 * openapi 的（`@ApiQuery`），在那之前 typed client **根本传不了这个参数**。
 */
export async function listSandboxes(projectId?: string): Promise<SandboxResponse[]> {
  const { data, error, response } = await apiClient.GET('/api/sandboxes', {
    params: { query: projectId === undefined ? {} : { projectId } },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}
