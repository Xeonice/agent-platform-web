// 冒烟切片：一条 typed openapi-fetch 调用（GET /api/health），走 msw mock。
import { apiClient } from '@/services/api/client';
import { toApiError } from '@/services/api/apiError';
import type { components } from '@/types/generated/openapi';

export type HealthResponse = components['schemas']['HealthResponse'];

/**
 * 拉取后端健康状态。演示：路径、响应 body 类型都来自生成类型；
 * 非 2xx 统一归一化为 ApiError（10 §6.8）。
 */
export async function getHealth(): Promise<HealthResponse> {
  const { data, error, response } = await apiClient.GET('/health');
  if (error !== undefined || data === undefined) {
    throw toApiError(error, response.status);
  }
  return data;
}
