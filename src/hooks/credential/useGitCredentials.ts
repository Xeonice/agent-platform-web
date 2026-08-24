// Git 凭证列表 Query（15 §2.1/§2.2）：服务端资源 → Query；staleTime 60s，保存/吊销后显式 invalidate。
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listGitCredentials } from '@/services/api/gitCredential.service';
import type { MaskedGitCredential } from '@/types/gitCredential';

/** Git 凭证专属 query key 工厂（15 §2.1，防 typo；kind 由 service 内置）。 */
export const gitCredentialKeys = {
  all: () => ['git-credentials'] as const,
  list: () => [...gitCredentialKeys.all(), 'list'] as const,
};

export function useGitCredentials(): UseQueryResult<MaskedGitCredential[]> {
  return useQuery({
    queryKey: gitCredentialKeys.list(),
    queryFn: listGitCredentials,
    staleTime: 60_000,
  });
}
