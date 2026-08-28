// 审计流的双向游标消费（F21-5 §3A、15 §2.1/§2.2、10 §6.6.1）。本仓**第一个游标无限列表**
// ——此前 `automationKeys.runs` 用的是 offset 页码，那套照抄过来会静默错位（见 ① ）。
//
// ⚠️ 七条纪律，每一条对应一个"改完页面看起来完全正常"的错误写法：
//
//  ① **offset 分页在 append-only 流上是错的。** 审计流一直在头部追加，用户翻到第 2 页时
//     若新到了 7 条，第 2 页会重复显示第 1 页尾部的 7 条——**而且看起来完全正常**。
//     所以翻页只认 `seq` 游标，`before=<当前最老 seq>`。
//
//  ② **两个方向分开，只有增量方向能轮询。** ⛔ 历史方向的 `useInfiniteQuery` **不许**在
//     "已经加载出行"的时候轮询：它会重拉**已加载的全部页**。滚了 10 页 ⇒ 每 30 秒 10 个请求，
//     返回内容与缓存**逐字节相同**。不会有任何报错，只会让人纳闷网络面板为什么这么吵。
//     增量方向是**另一条独立的轻量 query**，`refetchInterval: 30_000`，结果 prepend 进第一页。
//     （证伪用例：`containers/system/__tests__` 里"推进 30s 只发 1 个 since、0 个 before"。）
//
//     ⚠️ **唯一的例外是"一行都没有"的时候**，理由见 ⑦ 上面那条：那时缓存里只有一页空页，
//     重拉 = 1 个请求，且它是**唯一**能让面板自己动起来的通道。
//
//  ③ **增量拉满 `limit` = 有断层，必须显性说。** 异常风暴时 30s 内可能 >200 条——那恰恰是
//     最需要看清的时刻。产出 `gap` 交给 `AuditGapNotice`；⛔ 不静默连续渲染，
//     ⛔ 也不自动循环追平（那在风暴下是无界请求，且会把用户正在看的位置冲走）。
//
//  ④ **筛选切换只让「游标」天然重置，hook 自己的 state 不在其中。** `systemKeys.audit(filters)`
//     把 filters 放进 key：换筛选 = 换 key = 新缓存 = **游标**天然重置。若 filters 不进 key，
//     `before=5000` 在「全部」与「仅告警」下指向完全不同的位置——静默错乱。
//     ⛔ 但别把这句推广到 `useState`：`gap` 曾经就这么跨筛选活了下来，在「类别=凭证」的列表
//     中间渲染出一个**属于另一条流、在这里根本不存在的洞**，点 [加载中间部分] 还会把一整页
//     凭证历史 prepend 进去、再生成一个同样虚构的洞。故 `gap` **显式绑定到 `historyKey`**。
//     （F21-5 §3A ④ 已订正；原文写的"不需要**任何**手动 reset"正是这个 bug 的出处。）
//
//  ⑤ **时间范围是筛选（`from`/`to`）不是翻页。** 它与 `before` 是两套坐标；`at` 与 `seq`
//     只是近似同序，把时间折算成 seq 会在边界上悄悄吞记录。三者一律进 `AuditFilters`。
//
//  ⑥ **`isError` 不窄化掉。** 「暂无记录」盖住一次 500 是本页最坏的谎：用户会以为平台
//     什么都没发生，真相是审计接口挂了。空态与失败态必须是两个可区分的返回值。
//
//  ⑦ **增量通道自己的失败也要说出来（`isLiveUpdateError`）。** 这是 ⑥ 的同一个谎换了个时间点：
//     首屏成功、随后审计接口挂了、轮询一直 500 ⇒ 用户只是"看不到新事件"，
//     而"没有新事件"与"我不再知道有没有新事件"是两回事。异常风暴时审计接口最可能挂，
//     那恰恰是用户最需要知道"我看到的不是全部"的时刻。⛔ 它**不得**盖住已有列表
//     （那会把一次轮询失败放大成整面板不可用），只在卡片顶部挂一行提示 + [重试]。
import { useCallback, useMemo, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { listAudit } from '@/services/api/system.service';
import {
  AUDIT_PAGE_LIMIT,
  auditRows,
  gapAfterFill,
  gapFromIncremental,
  gapInsertIndex,
  maxSeqOf,
  mergeAuditEvents,
  mergeGap,
  minSeqOf,
} from '@/lib/audit/auditStream';
import type {
  AuditEventDto,
  AuditFilters,
  AuditGap,
  AuditListDto,
  AuditRowModel,
} from '@/types/audit';

/**
 * 系统状态页的 query key 工厂（15 §2.1）。
 * key 工厂一律写在**拥有这条 query 的 hook 文件**里（仓内 10 个工厂全是这个形态；
 * 28 §4 写的 `lib/queryKeys.ts` 磁盘上不存在）。`resources/providers/diagnose/init/settings`
 * 的 query 尚未落地（端点缺席），先把 key 备在这里，落地时直接取用、不另造一套。
 */
export const systemKeys = {
  all: () => ['system'] as const,
  init: () => [...systemKeys.all(), 'init'] as const,
  settings: () => [...systemKeys.all(), 'settings'] as const,
  resources: () => [...systemKeys.all(), 'resources'] as const,
  providers: () => [...systemKeys.all(), 'providers'] as const,
  diagnose: () => [...systemKeys.all(), 'diagnose'] as const,
  /** ⚠️ filters 进 key 是**必需的不是风格**——见文件头 ④。 */
  audit: (f: AuditFilters) => [...systemKeys.all(), 'audit', f] as const,
};

/** 与本页其它卡片同频（F21-5 §4）。 */
const AUDIT_POLL_MS = 30_000;

/** 历史方向的缓存形状：`pageParam` 就是 `before` 游标（首屏为 `undefined`）。 */
type AuditInfiniteData = InfiniteData<AuditListDto, number | undefined>;

export interface UseAuditStreamResult {
  /** 已按 `seq` 降序合并「增量 prepend」与「历史 append」两个方向，且已过客户端筛选。 */
  rows: AuditRowModel[];
  fetchOlder: () => void;
  hasOlder: boolean;
  isFetchingOlder: boolean;
  /** 非空 = 中间漏了，UI **必须**显性提示（不得静默连续渲染）。 */
  gap: AuditGap | null;
  /** 断层提示插在第几行**之前**（`null` = 不插）。算在这一层：容器碰不到 lib。 */
  gapIndex: number | null;
  /** [加载中间部分]：**一次只填一段**，不循环追平（③）。 */
  fillGap: () => void;
  isFillingGap: boolean;
  isPending: boolean;
  /** ⚠️ 与「rows 为空」是**两个**状态（⑥）。 */
  isError: boolean;
  /** 失败态的 [重试]。 */
  retry: () => void;
  /**
   * 增量（轮询）通道挂了 —— **历史方向可能仍然是好的**（⑦）。
   * UI 据此挂一行「实时更新已中断」，⛔ 不得用整块错误态盖住已有列表。
   */
  isLiveUpdateError: boolean;
  /** 「实时更新已中断」那一行的 [重试]：只重试增量通道。 */
  retryLiveUpdate: () => void;
}

function readEvents(client: QueryClient, key: QueryKey): AuditEventDto[] {
  const data = client.getQueryData<AuditInfiniteData>(key);
  if (data === undefined) return [];
  return data.pages.flatMap((page) => page.items);
}

/**
 * 把一批事件并进**第一页**。
 *
 * ⚠️ 只动第一页：`getNextPageParam` 读的是**最后一页**，往第一页塞东西不会扰动向下滚的游标。
 * 反过来若整体重排页结构，`before` 会跳，向下滚会漏掉一整段。
 */
function prependIntoFirstPage(
  client: QueryClient,
  key: QueryKey,
  incoming: readonly AuditEventDto[],
): void {
  if (incoming.length === 0) return;
  client.setQueryData<AuditInfiniteData>(key, (prev) => {
    if (prev === undefined) return prev;
    const [first, ...rest] = prev.pages;
    if (first === undefined) return prev;
    return {
      ...prev,
      pages: [{ ...first, items: mergeAuditEvents(first.items, incoming) }, ...rest],
    };
  });
}

export function useAuditStream(filters: AuditFilters): UseAuditStreamResult {
  const client = useQueryClient();
  const historyKey = useMemo(() => systemKeys.audit(filters), [filters]);

  // ——— `gap` 绑定到当前这条流（④）———
  // `gap` 是**跟着当前筛选才有意义**的 state：它的两个端点是这条流里的 seq。
  // 换筛选 ⇒ `historyKey` 变 ⇒ 这里当场读成 `null`，⛔ 绝不能把旧洞带进新流。
  // 用"渲染期按 key 判定"而不是 `useEffect` 清空：后者会先渲染一帧带着旧洞的新列表。
  const streamId = useMemo(() => JSON.stringify(historyKey), [historyKey]);
  const [gapState, setGapState] = useState<{ streamId: string; gap: AuditGap | null }>({
    streamId,
    gap: null,
  });
  const gap = gapState.streamId === streamId ? gapState.gap : null;
  const updateGap = useCallback(
    (next: (current: AuditGap | null) => AuditGap | null) => {
      setGapState((prev) => ({
        streamId,
        gap: next(prev.streamId === streamId ? prev.gap : null),
      }));
    },
    [streamId],
  );

  // ——— 历史方向（`before`，向下滚）———
  // append-only ⇒ 已加载的历史页**永不改变** ⇒ `staleTime: Infinity`，重拉是纯浪费。
  const initialPageParam: number | undefined = undefined;
  const history = useInfiniteQuery({
    queryKey: historyKey,
    queryFn: ({ pageParam }) =>
      listAudit({
        ...filters,
        ...(pageParam === undefined ? {} : { before: pageParam }),
        limit: AUDIT_PAGE_LIMIT,
      }),
    initialPageParam,
    // `hasMore` 在 `before` 方向 = 「还有更老的」；游标取**原始页**最老一条的 seq。
    getNextPageParam: (last: AuditListDto) => (last.hasMore ? minSeqOf(last.items) : undefined),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    // ⚠️ **只在"一行都没有"的时候轮询**（②的唯一例外），这是一条 100% 命中"全新部署第一次
    // 打开系统状态页"的通道：首屏 `{"items":[],"hasMore":false}` ⇒ 没有已见 seq ⇒ 增量方向
    // 无从下手（它必须带 `since`）。若这里也不轮询，用户在另一个标签页建了项目、表里已经有
    // 5 行，面板会**停在「暂无记录」不动**，`staleTime: Infinity` 连窗口聚焦都不重拉，
    // 只有整页刷新才会更新——而它看起来完全正常。
    // ⛔ 判据必须是"所有页都空"，不是"pages.length === 1"：一旦有了行就立刻停，
    // 否则就退化成 ② 明令禁止的"重拉已加载的全部页"。
    refetchInterval: (query) => {
      const pages = query.state.data?.pages;
      if (pages === undefined || pages.length === 0) return false;
      return pages.every((page) => page.items.length === 0) ? AUDIT_POLL_MS : false;
    },
  });

  const events = useMemo(
    () => (history.data === undefined ? [] : history.data.pages.flatMap((page) => page.items)),
    [history.data],
  );
  const seenMaxSeq = useMemo(() => maxSeqOf(events), [events]);

  // ——— 增量方向（`since`，新事件）———
  // 独立的轻量 query，只有它跟着 30s 轮询；结果 `setQueryData` prepend 进第一页。
  // 空表时它**不启动**（没有 `since` 可给）——那一段由上面历史方向的 `refetchInterval` 兜。
  const incremental = useQuery({
    queryKey: [...historyKey, 'incremental'],
    queryFn: async () => {
      // 游标取**已见最大 seq**（不是首屏末尾 seq），且从缓存现读——轮询回调里闭包变量可能已经过期。
      const since = maxSeqOf(readEvents(client, historyKey));
      if (since === undefined) return null;
      const page = await listAudit({ ...filters, since, limit: AUDIT_PAGE_LIMIT });
      prependIntoFirstPage(client, historyKey, page.items);
      // 拉满 limit ⇒ 中间漏了未知条数，必须显性说（③）。⛔ 这里**不**接着再拉一页。
      updateGap((current) =>
        mergeGap(current, gapFromIncremental(since, page.items, page.hasMore)),
      );
      return page;
    },
    enabled: seenMaxSeq !== undefined,
    refetchInterval: AUDIT_POLL_MS,
    staleTime: 0,
  });

  // ——— [加载中间部分]：一次一段 ———
  const fill = useMutation({
    mutationFn: (target: AuditGap) =>
      listAudit({ ...filters, before: target.beforeSeq, limit: AUDIT_PAGE_LIMIT }),
    retry: 0,
    onSuccess: (page, target) => {
      prependIntoFirstPage(client, historyKey, page.items);
      updateGap(() => gapAfterFill(target, page.items, page.hasMore));
    },
  });

  const fillGap = useCallback(() => {
    if (gap === null || fill.isPending) return;
    fill.mutate(gap);
  }, [gap, fill]);

  const fetchOlder = useCallback(() => {
    if (!history.hasNextPage || history.isFetchingNextPage) return;
    void history.fetchNextPage();
  }, [history]);

  const retry = useCallback(() => {
    void history.refetch();
  }, [history]);

  const refetchIncremental = incremental.refetch;
  const retryLiveUpdate = useCallback(() => {
    void refetchIncremental();
  }, [refetchIncremental]);

  const rows = useMemo(() => auditRows(events, Date.now()), [events]);

  return {
    rows,
    fetchOlder,
    hasOlder: history.hasNextPage,
    isFetchingOlder: history.isFetchingNextPage,
    gap,
    gapIndex: gapInsertIndex(rows, gap),
    fillGap,
    isFillingGap: fill.isPending,
    isPending: history.isPending,
    isError: history.isError,
    retry,
    isLiveUpdateError: incremental.isError,
    retryLiveUpdate,
  };
}
