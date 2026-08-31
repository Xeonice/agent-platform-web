// 已保留卷：列表 Query + 删除 mutation + 下载地址（F21-6 §3.3 / 审计 P2-5 三端点统一前缀）。
//
// ⚠️ 本 hook 同时承担 **DTO → 视图模型** 的转接：container 碰不到 `lib/`（eslint boundaries），
// 而单位换算、倒计时取整、排序全在 `lib/project/retainedVolumeModel`。与 `useSystemStatusModels`
// 同一形状——hook 自己不做判断，只把两边接起来，并注入那个"现在"。
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  deleteRetainedVolume,
  listRetainedVolumes,
  retainedVolumeArchiveUrl,
} from '@/services/api/retainedVolume.service';
import { ApiErrorException } from '@/services/api/apiError';
import { retainedVolumeRows, retainedVolumeTotals } from '@/lib/project/retainedVolumeModel';
import type { RetainedVolumeRow, RetainedVolumeTotals } from '@/types/retainedVolume';

export const retainedVolumeKeys = {
  all: () => ['retained-volumes'] as const,
  /** 按项目过滤（F21-5 的磁盘治理横幅看全局总量，走 `/system/resources`，不复用这个 key）。 */
  list: (projectId: string) => ['retained-volumes', 'list', projectId] as const,
};

/** 后端信封 → 人话。裸抛 `HTTP 500` 给用户看没有意义（10A E-5 同源）。 */
export function describeRetainedVolumeError(error: unknown): string | undefined {
  if (error === null || error === undefined) return undefined;
  if (error instanceof ApiErrorException) {
    if (error.httpStatus === 404) {
      // 已被 VolumeReaper 清掉、或另一个标签页刚删过。**不是错误，是竞态**。
      return '这个保留卷已经不存在了（可能刚被自动清理）。';
    }
    return error.envelope.message !== '' ? error.envelope.message : '操作失败，请稍后重试。';
  }
  return '网络错误，请稍后重试。';
}

export interface UseRetainedVolumesResult {
  rows: RetainedVolumeRow[];
  totals: RetainedVolumeTotals;
  loading: boolean;
  /** 列表本身取不回来（与"取回来是空的"是两回事，view 各有分支）。 */
  loadErrorMessage?: string;
  /** 删除失败的人话；成功后清空。 */
  actionErrorMessage?: string;
  /** 正在删除的那一条 id（逐行禁用，不是整面板禁用）。 */
  deletingId: string | null;
  remove: (id: string) => void;
  /** `<a href download>` 用的地址。⛔ 不要拿它去 fetch，见 service 里的长注释。 */
  archiveUrl: (id: string) => string;
}

export function useRetainedVolumes(projectId: string | null): UseRetainedVolumesResult {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: retainedVolumeKeys.list(projectId ?? ''),
    queryFn: () => listRetainedVolumes(projectId ?? ''),
    enabled: projectId !== null,
    staleTime: 30_000,
  });

  const remove = useMutation({
    mutationFn: deleteRetainedVolume,
    onSettled: () => {
      setDeletingId(null);
      // ⚠️ 失败也 invalidate：404 = 那条记录真的没了，列表必须跟着更新，
      //    否则用户会对着一条已经不存在的记录反复点删除。
      if (projectId !== null) {
        void queryClient.invalidateQueries({ queryKey: retainedVolumeKeys.list(projectId) });
      }
    },
  });

  // ⚠️ `new Date()` 在 hook 里而不是 lib 里：倒计时的边界（不足 1 天 / 还需 N 天 / 即将清理）
  //    要一个可注入的"现在"才测得了。与 `useSystemStatusModels` 同一处理。
  const data = query.data;
  const rows = useMemo(() => retainedVolumeRows(data ?? [], new Date()), [data]);
  const totals = useMemo(() => retainedVolumeTotals(data ?? []), [data]);

  const removeMutate = remove.mutate;
  const doRemove = useCallback(
    (id: string) => {
      setDeletingId(id);
      removeMutate(id);
    },
    [removeMutate],
  );

  const loadErrorMessage = query.isError ? describeRetainedVolumeError(query.error) : undefined;
  const actionErrorMessage = describeRetainedVolumeError(remove.error);

  return {
    rows,
    totals,
    loading: query.isPending && projectId !== null,
    ...(loadErrorMessage === undefined ? {} : { loadErrorMessage }),
    ...(actionErrorMessage === undefined ? {} : { actionErrorMessage }),
    deletingId,
    remove: doRemove,
    archiveUrl: retainedVolumeArchiveUrl,
  };
}
