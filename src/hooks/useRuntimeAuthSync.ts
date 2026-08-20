// WS runtime-auth.status_changed → Query 缓存 patch（15 §2.3）：两处同源——卡片徽标、横幅、Task 列表标记
// 都读同一份凭证状态。聚合端点用 invalidate，单 provider 状态用 invalidate（无整包覆盖数据时保守失效）。
// 副作用（网络刷新）归 hook 层；wire 进已挂载的 /events 单连接（useSandboxEventsSocket 回调），不另开连接。
import { useCallback } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { runtimeKeys, runtimeAuthKeys } from '@/hooks/useRuntimes';

/** 纯 patch（可单测）：某 runtime 凭证状态变化 → 失效聚合列表 + 该 provider 状态。 */
export function patchRuntimeAuthOnChange(queryClient: QueryClient, runtime: string): void {
  void queryClient.invalidateQueries({ queryKey: runtimeKeys.list() });
  void queryClient.invalidateQueries({ queryKey: runtimeAuthKeys.status(runtime) });
}

/** 返回一个稳定回调，供 useSandboxEventsSocket 的 onRuntimeAuthChanged 使用。 */
export function useRuntimeAuthSync(): (runtime: string) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (runtime: string) => {
      patchRuntimeAuthOnChange(queryClient, runtime);
    },
    [queryClient],
  );
}
