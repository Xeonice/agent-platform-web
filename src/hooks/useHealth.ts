// 冒烟切片：TanStack Query 包装 health service（服务端资源 → Query，15 §1）。
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getHealth, type HealthStatus } from '@/services/api/health.service';

export const healthKeys = {
  all: () => ['health'] as const,
};

export function useHealth(): UseQueryResult<HealthStatus> {
  return useQuery({
    queryKey: healthKeys.all(),
    queryFn: getHealth,
    staleTime: 30_000,
  });
}
