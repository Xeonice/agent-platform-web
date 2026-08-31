// 运行历史（P21-7 §3.3：最近 10 条 + [查看全部] 分页 20/页）。
//
// ★ **分页口径的坑先说清楚，因为它已经在这个仓里被点名过一次。**
//   `hooks/system/useAuditStream` 文件头 ① 写着：「此前 `automationKeys.runs` 用的是 offset
//   页码，那套照抄过来会静默错位」。那句话是写给审计流的，但**反过来同样成立** ——
//   运行历史也是从头部追加的列表，offset 分页在它身上有一模一样的毛病：
//   翻到第 2 页时若中间新记了 3 条运行，第 2 页的头 3 条就是第 1 页的尾 3 条，
//   **重复渲染，而且看起来完全正常**。
//
//   ✅ **2026-08-31：后端已换成 `before=<runId>` 游标**（`{ items, hasMore }`，与
//   `GET /api/system/audit` 同形），所以这里不再需要"在前端消后果"那两层：
//     · 一把 key 仍然保留 —— 它本来就是游标分页该有的形状（整体重取 = 同一时刻的快照）；
//     · ⛔ `dedupeRunsById` **已删**。游标下不会再重复，留着反而会**掩盖游标实现的 bug**
//       （真重复了却被悄悄去掉，看不出来）。
//
// ⛔ **没有 `refetchInterval`**（15 §2.2 也没给它配）：`useInfiniteQuery` 上的轮询会重拉
//   **已加载的全部页**，滚了 5 页就是每轮 5 个请求，返回内容与缓存逐字节相同。
import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { listAutomationRuns } from '@/services/api/automation.service';
import { automationKeys, describeAutomationError } from '@/hooks/automation/useAutomations';
import { runRows } from '@/lib/automation/automationModel';
import { RUNS_PAGE_SIZE, RUNS_PREVIEW_COUNT, type RunRow } from '@/types/automation';

export interface UseAutomationRunsResult {
  /** 已加载的全部行（去重后）。 */
  rows: RunRow[];
  /** 折叠态只显示最近 10 条（P21-7 §3.3）。 */
  previewRows: RunRow[];
  loading: boolean;
  loadErrorMessage?: string;
  /** 还有更多页可拉（[查看全部] / [加载更多] 的 enabled 判据）。 */
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

/**
 * @param timeZone **规则的时区快照**，用于格式化每一行的触发时刻。
 *   ⛔ 不是浏览器时区 —— 一条 Asia/Shanghai 的规则，它的运行历史必须按 Asia/Shanghai 显示，
 *   否则用户在别的时区打开会看到一串"不在自己配的时刻"的记录，并以为调度器出了问题。
 */
export function useAutomationRuns(
  automationId: string | null,
  timeZone: string,
): UseAutomationRunsResult {
  const queryClient = useQueryClient();
  const key = automationKeys.runs(automationId ?? '');

  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => listAutomationRuns(automationId ?? '', pageParam),
    initialPageParam: undefined as string | undefined,
    // 游标 = 当前这一页**最老那条**的 id；后端返回严格早于它的下一批。
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.items[lastPage.items.length - 1]?.id : undefined,
    enabled: automationId !== null,
    // 15 §2.2：运行历史 30s / 5min。
    staleTime: 30_000,
    gcTime: 300_000,
  });

  const pages = query.data?.pages;
  const runs = useMemo(() => (pages ?? []).flatMap((p) => p.items), [pages]);
  const rows = useMemo(() => runRows(runs, timeZone), [runs, timeZone]);
  const previewRows = useMemo(() => rows.slice(0, RUNS_PREVIEW_COUNT), [rows]);

  const fetchNextPage = query.fetchNextPage;
  const loadMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: key });
    // key 是每次渲染新建的数组，但内容由 automationId 决定；用 id 做依赖即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [automationId, queryClient]);

  const loadErrorMessage = query.isError ? describeAutomationError(query.error) : undefined;

  return {
    rows,
    previewRows,
    loading: query.isPending && automationId !== null,
    ...(loadErrorMessage === undefined ? {} : { loadErrorMessage }),
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore,
    refresh,
  };
}

/** 每页条数对外暴露一份，story / 测试造替身时不必再抄 20。 */
export { RUNS_PAGE_SIZE };
