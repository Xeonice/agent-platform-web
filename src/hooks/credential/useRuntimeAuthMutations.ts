// Runtime 鉴权 mutation（15 §2.4）：切模式 / 吊销。成功后 invalidate runtime 聚合 + 鉴权状态两族
//（三处同源：卡片徽标、横幅、Task 列表标记读同一份，15 §2.3）。mutations 不自动重试（15 §2.2）。
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
  type QueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { setAuthMode, revokeRuntimeCredential } from '@/services/api/runtime.service';
import { runtimeKeys, runtimeAuthKeys } from '@/hooks/credential/useRuntimes';
import type { RuntimeAuthMode, RuntimeSettings } from '@/types/runtimeCredential';

/** 重授权/切模式/吊销后统一失效 runtime 两族（同源刷新）。导出以便 AuthGateContainer 成功回调复用。 */
export function invalidateRuntimeAuth(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: runtimeKeys.list() });
  void queryClient.invalidateQueries({ queryKey: runtimeAuthKeys.all() });
}

/**
 * 授权成功后**必须做的两件事**：刷新 runtime 状态 + 让用户看见自己成功了。
 *
 * ── 它修的是什么：一次成功了却没人告诉用户的授权（2026-09-07 实测）──────────────
 * ⛔ 这两件事此前在**两处宿主各写一遍**（系统设置页的 `useCredentials.onAuthSuccess`、
 *    向导的 `InitWizardContainer`），而向导那份**只收起了面板** —— 既不刷新也不提示。
 *    真机结果：设备码授权成功、凭证已落库（后端 `CredentialStored` 事件在），
 *    而界面上面板无声无息地关掉了。用户唯一能确认自己成功了的办法是**刷新整个页面**。
 *
 * ⚠️ 更阴的是向导那份还带着一句注释「状态由 runtimeKeys.list 的 invalidate 驱动刷新」——
 *    **描述的是一件它没做的事**。一条撒谎的注释让这个漏洞看起来像是已经处理过了。
 *
 * ⇒ 收成一处。⛔ **收起面板不在这里**：那是各宿主自己的 UI 状态（向导是
 *   `setExpandedRuntime`，设置页是 `setExpandedPanel`），强行统一只会把两个不同的
 *   东西塞进一个参数里。这里只放两处都必须做、且漏掉就会让用户看不见结果的那两件。
 */
export function notifyRuntimeAuthConfigured(
  queryClient: QueryClient,
  message = '凭证已更新',
): void {
  invalidateRuntimeAuth(queryClient);
  toast.success(message);
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
