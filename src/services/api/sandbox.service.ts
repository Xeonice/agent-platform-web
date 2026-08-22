// 沙箱 REST（07 §2）：唯一 fetch 层。类型全部来自生成物（CreateSandboxDto / SandboxResponseDto），前端不手写。
import { apiClient } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import type { components } from '@/types/generated/openapi';

export type CreateSandboxInput = components['schemas']['CreateSandboxDto'];
/**
 * 沙箱（Task）响应。三个与 S5 相关的字段全部来自生成物，**前端不手写、不派生**：
 *  · `name`（required）—— 后端在创建时从 initialPrompt 派生的默认任务名（10 §7.3，规则 P21-1 §9）。
 *    前端刷新后手里没有 prompt（DTO 刻意不回显），本就算不出来，故一律直接用它。
 *  · `failureCode?` —— **错误码闭集**（04 §4；无码错误兜底 INTERNAL），仅 `status:'failed'` 时出现。
 *  · `failureMessage?` —— **纯自由文本细节**，排障用。⚠️ 码已与文本拆成两列，
 *    **不要从 message 里 parse 码**；人话一律按 failureCode 查 P22 §1。
 * DTO 带这两个字段 ⇒ **刷新后仍能恢复失败原因**（WS 帧错过了就没了，这条才是救命稻草）。
 */
export type SandboxResponse = components['schemas']['SandboxResponseDto'];

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
