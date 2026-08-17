// 项目 REST（07 §2）：走全站唯一 typed apiClient（与 sandbox.service 一致），路径/参数/响应均受生成 openapi.d.ts 约束。
// cloneStatus 等由生成类型强制（改后端契约 → generate:api → 此处编译期报红）；credentials 由 apiClient 统一 include（口令门 11 §3.1）。
import { apiClient } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import type { CreateProjectInput, ProjectDto } from '@/types/project';

/** GET /api/projects → ProjectResponseDto[]（含 cloneStatus；不含 repoUrl）。 */
export async function listProjects(): Promise<ProjectDto[]> {
  const { data, error, response } = await apiClient.GET('/api/projects');
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** POST /api/projects → 202 ProjectResponseDto（git ⇒ 异步克隆 cloning，empty ⇒ ready）。repoUrl 只在请求体。 */
export async function createProject(input: CreateProjectInput): Promise<ProjectDto> {
  const { data, error, response } = await apiClient.POST('/api/projects', { body: input });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** DELETE /api/projects/{id}（204，可选保留 baseline）。 */
export async function deleteProject(id: string): Promise<void> {
  const { error, response } = await apiClient.DELETE('/api/projects/{id}', {
    params: { path: { id } },
    body: {}, // DeleteProjectDto 全可选（keepBaseline?）；默认不保留 baseline
  });
  if (!response.ok) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
}

/** POST /api/projects/{id}/retry-clone → 202（重试失败的克隆）。 */
export async function retryClone(id: string): Promise<ProjectDto> {
  const { data, error, response } = await apiClient.POST('/api/projects/{id}/retry-clone', {
    params: { path: { id } },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** POST /api/projects/{id}/convert-to-empty → 仅 failed 态可转（非该态后端 409）。 */
export async function convertToEmpty(id: string): Promise<ProjectDto> {
  const { data, error, response } = await apiClient.POST('/api/projects/{id}/convert-to-empty', {
    params: { path: { id } },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}
