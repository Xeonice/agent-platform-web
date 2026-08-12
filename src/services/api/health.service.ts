// 冒烟切片：一条 typed openapi-fetch 调用，对齐后端真实路径 `GET /api/health`（后端 setGlobalPrefix('api')）。
// 路径字符串受生成的 paths 类型约束：写错路径（如漏 /api）即编译期报红——这就是"共用 interface"的落点。
import { apiClient } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';

export interface HealthStatus {
  ok: boolean;
  status: number;
}

/**
 * 拉取后端健康状态（liveness probe，无响应体 schema）。
 * 非 2xx 统一归一化为 ApiError（10 §6.8）。
 */
export async function getHealth(): Promise<HealthStatus> {
  const { error, response } = await apiClient.GET('/api/health');
  if (!response.ok) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return { ok: true, status: response.status };
}
