// 无头 Task REST（07 §2）：唯一 fetch 层，走全站唯一 typed apiClient。
// 类型全部来自生成物（`RunAgentTaskDto` / `AgentTaskResponseDto`）——改后端契约 → `openapi:emit`
// → `generate:api` → 此处编译期报红。与 sandbox.service.ts 同形。
import { apiClient, API_BASE_URL } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import type { AgentTaskDto, RunAgentTaskInput } from '@/types/task';

/**
 * POST /api/sandboxes/{id}/runtimes/{rt}/tasks → **202 AgentTaskDto**（整个 DTO，不是 `{taskId}`）。
 * 202 = 已受理、尚未完成：拿到 DTO 后一切进展走 /tasks WS，**不轮询**。
 */
export async function runAgentTask(
  sandboxId: string,
  runtime: string,
  input: RunAgentTaskInput,
): Promise<AgentTaskDto> {
  const { data, error, response } = await apiClient.POST(
    '/api/sandboxes/{id}/runtimes/{rt}/tasks',
    { params: { path: { id: sandboxId, rt: runtime } }, body: input },
  );
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/**
 * GET /api/sandboxes/{id}/tasks → AgentTaskDto[]（**startedAt 倒序**）。
 *
 * 这是**刷新恢复的权威来源**：持久化的 `selectedTaskId` 只是快路径，必须拿这份列表校验
 * （任务可能已被清理），校验不过就回落到列表里那个仍在跑的任务。
 */
export async function listAgentTasks(sandboxId: string): Promise<AgentTaskDto[]> {
  const { data, error, response } = await apiClient.GET('/api/sandboxes/{id}/tasks', {
    params: { path: { id: sandboxId } },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/**
 * GET /api/sandboxes/{id}/tasks/{taskId} → AgentTaskDto（单条）。
 * 前端当前**不用它**：列表端点已是权威来源，单条查询会让"当前任务"有两个真相源。
 * 保留是因为端点存在；接入前先想清楚为什么列表不够。
 */
export async function getAgentTask(sandboxId: string, taskId: string): Promise<AgentTaskDto> {
  const { data, error, response } = await apiClient.GET('/api/sandboxes/{id}/tasks/{taskId}', {
    params: { path: { id: sandboxId, taskId } },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/**
 * POST /api/sandboxes/{id}/tasks/{taskId}/cancel → 202 AgentTaskDto（两阶段强杀，终态 `killed`）。
 *
 * 202 = 已受理：真正的终态由 /tasks 的 `exit` 帧宣告，本调用只负责把"请求终止"送达。
 */
export async function cancelAgentTask(sandboxId: string, taskId: string): Promise<AgentTaskDto> {
  const { data, error, response } = await apiClient.POST(
    '/api/sandboxes/{id}/tasks/{taskId}/cancel',
    { params: { path: { id: sandboxId, taskId } } },
  );
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/**
 * GET /api/sandboxes/{id}/tasks/{taskId}/artifacts/{name} → **原始 Response**（不是 Blob）。
 *
 * ⚠️ **本仓唯一还留着裸 fetch 的端点**，两个理由：
 *  ① 它在 openapi 里是 `content?: never`（原始字节，没有 JSON schema）⇒ typed client 取不到响应体；
 *  ② 刻意不给 `<a href>` 直链：产物端点同样受口令门保护，而跨源下载导航未必带上 SameSite cookie
 *     ⇒ 直链在启用口令门后会静默 401。存盘动作留给 hook 层，本层只负责"把这条流取到手"。
 *
 * ⚠️ **为什么回 Response 而不是 Blob**：`response.blob()` 会把整个产物读进内存 ——
 * 几百 MB 的产物足以把标签页拖垮甚至 OOM。把 Response 原样交出去，hook 层才能把
 * `response.body` 直接管到磁盘（File System Access API），一个字节都不进堆；
 * 同时 `content-length` 也还在 headers 上，可以据此显示进度。
 * 非 2xx 仍在本层归一化成 `ApiErrorException`（错误体是 JSON，读它不涉及大流量）。
 */
export async function fetchTaskArtifact(
  sandboxId: string,
  taskId: string,
  name: string,
): Promise<Response> {
  const response = await fetch(
    `${API_BASE_URL}/api/sandboxes/${encodeURIComponent(sandboxId)}/tasks/${encodeURIComponent(taskId)}/artifacts/${encodeURIComponent(name)}`,
    // 与 apiClient 同一套跨源纪律：带上 HttpOnly `ap_session` cookie（口令门 11 §3.1）。
    { credentials: 'include' },
  );
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    throw new ApiErrorException(toApiError(body, response.status), response.status);
  }
  return response;
}
