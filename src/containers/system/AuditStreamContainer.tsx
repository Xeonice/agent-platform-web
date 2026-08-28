'use client';
// 审计流容器（F21-5 §3/§5）：**唯一的 view ↔ hook 粘合点**。
// 游标、轮询、断层、合并全在 `useAuditStream`；时间换算与派生文案全在 `lib/audit/`；
// 这里只持有"用户当前选了什么"这一点 UI state，并把结果装配进视图。
//
// ⚠️ **筛选切换这里没有任何 reset 游标的代码，这是对的**（§3A ④）：`filters` 变 ⇒
// `systemKeys.audit(filters)` 变 ⇒ 新缓存 ⇒ 游标天然从头开始。谁要是在这里加一句
// "切筛选时清空 pages"，测试照旧全绿，而真正的 bug（旧游标配新筛选）已经被 key 挡掉了，
// 那句代码只会在日后掩盖 key 退化。
// ⚠️ 但**「游标天然重置」只管游标**：`useAuditStream` 里跟着筛选才有意义的 state（`gap`）
// 是在那一层显式绑到 `historyKey` 上清掉的，不是靠这句话（§3A ④ 已订正）。
//
// ⚠️ **时间范围是筛选不是翻页**（§3A ⑤）：`datetime-local` 的原样字符串留在本地 state
// （否则受控输入会在用户打字打到一半时被清空），转成 ISO 后进 `filters.from/to`。
import { useCallback, useState } from 'react';
import { useAuditFilters } from '@/hooks/system/useAuditFilters';
import { useAuditStream } from '@/hooks/system/useAuditStream';
import { useExportAuditLogs } from '@/hooks/system/useExportAuditLogs';
import { AuditStreamCardView } from '@/views/system/AuditStreamCard.view';
import { AuditFilterBarView } from '@/views/system/AuditFilterBar.view';

export interface AuditStreamContainerProps {
  /** 沙箱详情时间线复用本容器时给（P21-5 §10.2）；页面里不给。 */
  initialSubjectId?: string;
}

export function AuditStreamContainer({ initialSubjectId }: AuditStreamContainerProps = {}) {
  const f = useAuditFilters(initialSubjectId);
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null);

  const stream = useAuditStream(f.filters);
  const exportLogs = useExportAuditLogs();

  const toggleDetail = useCallback((seq: number) => {
    setExpandedSeq((current) => (current === seq ? null : seq));
  }, []);

  // [查看该沙箱完整时间线]：**同一个 hook**，只是把 `subjectId` 塞进 filters
  // ——于是游标、断层、轮询这套东西一行都不用重写（§5）。
  const setSubjectId = f.setSubjectId;
  const openTimeline = useCallback(
    (next: string) => {
      setSubjectId(next);
      setExpandedSeq(null);
    },
    [setSubjectId],
  );

  const clearFilters = f.clear;

  return (
    <AuditStreamCardView
      rows={stream.rows}
      isPending={stream.isPending}
      isError={stream.isError}
      isLiveUpdateError={stream.isLiveUpdateError}
      emptyKind={f.emptyKind}
      filterSummary={f.filterSummary}
      gap={stream.gap}
      gapIndex={stream.gapIndex}
      isFillingGap={stream.isFillingGap}
      hasOlder={stream.hasOlder}
      isFetchingOlder={stream.isFetchingOlder}
      expandedSeq={expandedSeq}
      onToggleDetail={toggleDetail}
      onOpenTimeline={openTimeline}
      onFillGap={stream.fillGap}
      onReachEnd={stream.fetchOlder}
      onRetry={stream.retry}
      onRetryLiveUpdate={stream.retryLiveUpdate}
      onClearFilters={clearFilters}
      onExport={exportLogs}
      filterBar={
        <AuditFilterBarView
          category={f.category}
          alertsOnly={f.alertsOnly}
          fromLocal={f.fromLocal}
          toLocal={f.toLocal}
          onCategoryChange={f.setCategory}
          onAlertsOnlyChange={f.setAlertsOnly}
          onFromChange={f.setFromLocal}
          onToChange={f.setToLocal}
        />
      }
    />
  );
}
