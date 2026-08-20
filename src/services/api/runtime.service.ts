// Runtime 鉴权/凭证 REST（07 §6.3 端点表，与 05 §3 一一对应，前端不自造路径）。
// 走全站唯一 typed apiClient（与 project/sandbox/gitCredential.service 一致）：路径/参数/响应均受生成 openapi.d.ts
// 约束（改后端契约 → generate:api → 此处编译期报红）。**鉴权路径均无 sandbox 段**（auth helper，05 §2 决策 A）。
import { apiClient } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import type {
  RuntimeDto,
  AuthChallenge,
  AuthStatusResponse,
  RuntimeCredentialResult,
  RuntimeSettings,
  RuntimeAuthMethod,
  RuntimeAuthMode,
} from '@/types/runtimeCredential';

/** GET /api/runtimes → 各 runtime 卡片元数据 + 凭证状态聚合 + 逐模式明细（主数据源，F21-3 §4）。 */
export async function listRuntimes(): Promise<RuntimeDto[]> {
  const { data, error, response } = await apiClient.GET('/api/runtimes');
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** GET /api/runtimes/:rt/credentials/status → 单 runtime 状态（重授权后局部刷新，回同构 RuntimeDto）。 */
export async function getRuntimeAuthStatus(rt: string): Promise<RuntimeDto> {
  const { data, error, response } = await apiClient.GET('/api/runtimes/{rt}/credentials/status', {
    params: { path: { rt } },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** POST /api/runtimes/:rt/auth/begin → 在 auth helper 内起帐号授权，返回 AuthChallenge（method=方式）。 */
export async function beginAuth(
  rt: string,
  method: 'oauth-device' | 'setup-token',
): Promise<AuthChallenge> {
  const { data, error, response } = await apiClient.POST('/api/runtimes/{rt}/auth/begin', {
    params: { path: { rt } },
    body: { method },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** GET /api/runtimes/:rt/auth/status?challengeRef= → device-code 轮询态。 */
export async function pollAuthStatus(
  rt: string,
  challengeRef: string,
): Promise<AuthStatusResponse> {
  const { data, error, response } = await apiClient.GET('/api/runtimes/{rt}/auth/status', {
    params: { path: { rt }, query: { challengeRef } },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** POST /api/runtimes/:rt/auth/complete → 提交回贴的授权 code（setup-token；pastedText 提交即清空）。 */
export async function completeAuth(
  rt: string,
  challengeRef: string,
  pastedText: string,
): Promise<RuntimeCredentialResult> {
  const { data, error, response } = await apiClient.POST('/api/runtimes/{rt}/auth/complete', {
    params: { path: { rt } },
    body: { challengeRef, pastedText },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** POST /api/runtimes/:rt/credentials/secret → 直存 api-key（body 字段名 method，不经 sandbox）。 */
export async function saveSecret(rt: string, secret: string): Promise<RuntimeCredentialResult> {
  const { data, error, response } = await apiClient.POST('/api/runtimes/{rt}/credentials/secret', {
    params: { path: { rt } },
    body: { method: 'api-key', secret },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** PUT /api/runtimes/:rt/auth-mode → 切换生效模式（**body 字段名 method 不是 mode**，P1-1；未配置 → 409）。 */
export async function setAuthMode(rt: string, method: RuntimeAuthMode): Promise<RuntimeSettings> {
  const { data, error, response } = await apiClient.PUT('/api/runtimes/{rt}/auth-mode', {
    params: { path: { rt } },
    body: { method },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/** DELETE /api/runtimes/:rt/credentials/:credentialId → 吊销（强制重启注入该凭证的运行实例，05 §4）。 */
export async function revokeRuntimeCredential(rt: string, credentialId: string): Promise<void> {
  const { error, response } = await apiClient.DELETE(
    '/api/runtimes/{rt}/credentials/{credentialId}',
    {
      params: { path: { rt, credentialId } },
    },
  );
  if (!response.ok) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
}

/** 帐号授权类方式（oauth-device / setup-token）→ 生效模式 'account'；api-key → 'api-key'（05 §4）。 */
export function authMethodToMode(method: RuntimeAuthMethod): RuntimeAuthMode {
  return method === 'api-key' ? 'api-key' : 'account';
}
