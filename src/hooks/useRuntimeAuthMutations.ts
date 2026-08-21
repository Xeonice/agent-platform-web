// Runtime 鉴权 mutation（15 §2.4）：切模式 / 吊销。成功后 invalidate runtime 聚合 + 鉴权状态两族
//（三处同源：卡片徽标、横幅、Task 列表标记读同一份，15 §2.3）。mutations 不自动重试（15 §2.2）。
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
  type QueryClient,
} from '@tanstack/react-query';
import { setAuthMode, revokeRuntimeCredential } from '@/services/api/runtime.service';
import { runtimeKeys, runtimeAuthKeys } from '@/hooks/useRuntimes';
import type { RuntimeAuthMode, RuntimeSettings } from '@/types/runtimeCredential';

/** 重授权/切模式/吊销后统一失效 runtime 两族（同源刷新）。导出以便 AuthGateContainer 成功回调复用。 */
export function invalidateRuntimeAuth(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: runtimeKeys.list() });
  void queryClient.invalidateQueries({ queryKey: runtimeAuthKeys.all() });
}

export interface SetAuthModeVars {
  runtimeId: string;
  method: RuntimeAuthMode;
}

export function useSetAuthMode(): UseMutationResult<RuntimeSettings, Error, SetAuthModeVars> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runtimeId, method }: SetAuthModeVars) => setAuthMode(runtimeId, method),
    onSuccess: () => {
      invalidateRuntimeAuth(queryClient);
    },
  });
}

export interface RevokeRuntimeVars {
  runtimeId: string;
  credentialId: string;
}

export function useRevokeRuntimeCredential(): UseMutationResult<void, Error, RevokeRuntimeVars> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runtimeId, credentialId }: RevokeRuntimeVars) =>
      revokeRuntimeCredential(runtimeId, credentialId),
    onSuccess: () => {
      invalidateRuntimeAuth(queryClient);
    },
  });
}
