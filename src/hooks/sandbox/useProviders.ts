// provider registry Query（15 §1：服务端资源 → Query）。
// registry 内容只在后端注册/卸载 provider 时才变（极低频）→ staleTime 5min，压掉重复请求。
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listProviders } from '@/services/api/provider.service';
import type { SandboxProviderDto } from '@/types/sandbox';

/** provider registry query key（15 §2.1，GET /api/providers）。 */
export const providerKeys = {
  all: () => ['providers'] as const,
  list: () => [...providerKeys.all(), 'list'] as const,
};

/** provider 列表（扁平数组；默认档 = 数组里 isDefault 的那项，前端不再有默认常量）。 */
export function useProviders(): UseQueryResult<SandboxProviderDto[]> {
  return useQuery({
    queryKey: providerKeys.list(),
    queryFn: listProviders,
    staleTime: 5 * 60_000,
  });
}
