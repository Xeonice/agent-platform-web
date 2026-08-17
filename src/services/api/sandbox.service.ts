// 沙箱 REST（07 §2）：唯一 fetch 层。类型全部来自生成物（CreateSandboxDto / SandboxResponseDto），前端不手写。
import { apiClient } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import type { components } from '@/types/generated/openapi';

export type CreateSandboxInput = components['schemas']['CreateSandboxDto'];
export type SandboxResponse = components['schemas']['SandboxResponseDto'];

/** POST /api/sandboxes → 201 SandboxResponseDto（含后端生成的 socket 会话入口所需的 id）。 */
export async function createSandbox(input: CreateSandboxInput): Promise<SandboxResponse> {
  const { data, error, response } = await apiClient.POST('/api/sandboxes', { body: input });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** GET /api/sandboxes/{id} → SandboxResponseDto。 */
export async function getSandbox(id: string): Promise<SandboxResponse> {
  const { data, error, response } = await apiClient.GET('/api/sandboxes/{id}', {
    params: { path: { id } },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}
