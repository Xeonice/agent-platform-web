// 项目 REST（07 §2）：走全站唯一 typed apiClient（与 sandbox.service 一致），路径/参数/响应均受生成 openapi.d.ts 约束。
// cloneStatus 等由生成类型强制（改后端契约 → generate:api → 此处编译期报红）；credentials 由 apiClient 统一 include（口令门 11 §3.1）。
import { apiClient } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import type { CreateProjectInput, ProjectDto } from '@/types/project';

/** GET /api/projects → ProjectResponseDto[]（含 cloneStatus 与基线四字段，见 types/project）。 */
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

/**
 * POST /api/projects/{id}/cancel-clone → 200 ProjectResponseDto（取消进行中的克隆，**项目保留**）。
 *
 * ⚠️ **与 `deleteProject` 是两件事，别混**（F21-6 §10.6 第 2 条）：这条只是停下克隆、
 * 把项目留在树里（后端转 `failed`，用户可以再 [重试克隆] 或 [改为空项目]）；
 * 而对 `cloning` 项目调 DELETE，后端会**先取消克隆再把项目一起删掉**。
 * 两个动作在菜单里必须分开，文案也不能像。
 */
export async function cancelClone(id: string): Promise<ProjectDto> {
  const { data, error, response } = await apiClient.POST('/api/projects/{id}/cancel-clone', {
    params: { path: { id } },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/**
 * GET /api/projects/{id}/branches → `string[]`。
 *
 * ⚠️ **不触网、不需要凭证**：完整克隆（03 §7.2★）之后后端读的是**本地**引用
 * （`git branch -r`），不是 `ls-remote`。这是选完整克隆而非"按需 fetch"的直接红利——
 * 这条路上一条网络失败路径都没有，因此前端也**不为它设计"配 Git 凭证"分支**。
 */
export async function listProjectBranches(id: string): Promise<string[]> {
  const { data, error, response } = await apiClient.GET('/api/projects/{id}/branches', {
    params: { path: { id } },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  // typed client 只管**编译期**：openapi-fetch 运行时把 body 原样交出来，不校验形状。
  // 契约是裸 `string[]`；后端哪天改成 `{branches:[…]}`，编译不会红（生成物还没同步），
  // 而选择器会渲染出一串 undefined —— 没有任何一处报错。这四行就是拦它的。
  if (!Array.isArray(data) || data.some((item) => typeof item !== 'string')) {
    throw new ApiErrorException(toApiError(undefined, response.status), response.status);
  }
  return data;
}

/**
 * POST /api/projects/{id}/sync → 重新同步基线（仅 `ready` 态；后端对其余状态拒）。
 *
 * ⚠️ 只更新**基线**：已有 Task 的工作区一律不动（它们是当时的写时复制副本）。
 * 这条语义刻意不在 UI 上呈现（F21-6 §9.3），本函数只负责把动作发出去。
 * 响应体本轮不消费（成功后调用方 invalidate 项目列表拿新的 `updatedAt`）。
 */
export async function syncProject(id: string): Promise<void> {
  const { error, response } = await apiClient.POST('/api/projects/{id}/sync', {
    params: { path: { id } },
  });
  if (!response.ok) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
}
