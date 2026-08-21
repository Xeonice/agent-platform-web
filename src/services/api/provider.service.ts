// sandbox provider registry 只读 REST（07 §2）：唯一 fetch 层，走全站唯一 typed apiClient。
// 后端 registry 是开放的（第三方可注册），前端只读回显，绝不在此处过滤/补齐/枚举 provider 名。
// 类型来自生成物（ProviderResponseDto），改后端契约 → generate:api → 此处编译期报红。
import { apiClient } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import type { SandboxProviderDto } from '@/types/sandbox';

/** GET /api/providers → ProviderResponseDto[]（扁平数组，默认档由数组项的 isDefault 标记）。 */
export async function listProviders(): Promise<SandboxProviderDto[]> {
  const { data, error, response } = await apiClient.GET('/api/providers');
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}
