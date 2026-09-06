// Runtime 聚合 Query（15 §2.1/§2.2）：GET /api/runtimes 卡片元数据 + 凭证状态，向导 Step1 与凭证页共用。
// staleTime 60s（卡片元数据基本静态；凭证状态变化由 WS runtime-auth.status_changed 驱动 patch/invalidate）。
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listRuntimes, getRuntimeAuthStatus } from '@/services/api/runtime.service';
import type { RuntimeDto } from '@/types/runtimeCredential';

/** runtime 聚合 query key（15 §2.1，GET /api/runtimes）。 */
export const runtimeKeys = {
  all: () => ['runtimes'] as const,
  list: () => [...runtimeKeys.all(), 'list'] as const,
};

/** runtime 鉴权状态 query key（15 §2.1；单 provider 局部刷新 / device-code 会话轮询）。 */
export const runtimeAuthKeys = {
  all: () => ['runtime-auth'] as const,
  status: (provider: string) => [...runtimeAuthKeys.all(), provider, 'status'] as const,
  session: (provider: string) => [...runtimeAuthKeys.all(), provider, 'session'] as const,
};

/**
 * runtime 列表的查询选项。
 *
 * ⚠️ **抽成常量是为了让第二个消费方（初始化向导 Step4）用同一份**：同一个 queryKey 被两处
 * 用不同的 `staleTime` 声明时，什么时候重取取决于哪个观察者先挂载 —— 表现是「在凭证页
 * 授权完，回向导那一步还显示未配置，刷新一下又好了」。与 `DIAGNOSE_CACHE_OPTIONS` 同一条。
 */
export const RUNTIMES_QUERY_OPTIONS = {
  queryKey: runtimeKeys.list(),
  queryFn: listRuntimes,
  staleTime: 60_000,
} as const;

export function useRuntimes(): UseQueryResult<RuntimeDto[]> {
  return useQuery(RUNTIMES_QUERY_OPTIONS);
}

export function useRuntimeAuthStatus(provider: string, enabled = true): UseQueryResult<RuntimeDto> {
  return useQuery({
    queryKey: runtimeAuthKeys.status(provider),
    queryFn: () => getRuntimeAuthStatus(provider),
    staleTime: 60_000,
    enabled,
  });
}
