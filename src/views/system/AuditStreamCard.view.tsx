// 审计流卡片（F21-5 §3 / §6 状态矩阵后六行 / P21-5 §10.2）。纯展示、props 驱动、零副作用。
//
// ⚠️ **这个卡片不是运行日志**（P21-5 §10.1）。同屏还有 provider 卡片里的 `ProviderLogPanel`
// ——那是文本行、给运维看；这里是结构化事件、给产品用户看。两者在组件层**不共享任何视图**，
// 就是为了挡住"顺手合并成一个日志区"的那一手：合了以后页面变成一屏刷不完的噪音，
// 用户第一次点开就再也不点第二次。
//
// ⚠️ **四个空/失败分支是四个东西，压不成一个**（§3A ⑥）：
//   · 加载中 → 骨架 × 5（**不是整块 spinner**：列表有稳定高度，避免筛选切换时页面跳动）
//   · 失败   → 「审计流加载失败 [重试]」。⛔ 这里**绝不出现「暂无记录」**——
//              「暂无记录」盖住一次 500 是本页最坏的谎：用户以为平台什么都没发生，
//              真相是审计接口挂了。
//   · 筛选无结果 → 「当前筛选无匹配记录 [清除筛选]」（与下两条**都不同文案**）
//   · 真的没有   → 「暂无记录」+ 当前筛选条件说明（**不是空白**，空白让人以为坏了）
//   · 该类尚未记录 → 「该类事件平台尚未记录」（`emptyKind === 'category-not-yet-emitted'`）。
//              契约先给类别、后端后补写入点，中间那段窗口里这一类一条都没有。说成
//              「当前筛选无匹配记录」，用户读出来的是"这类操作从来没发生过"——而真相是
//              "发生了，只是平台还没开始记"。判定在 `lib/audit` 的 `auditEmptyKind`。
//              ⚠️ 2026-08-28 后端补齐镜像/系统两档后，五个类别全部有生产者，这一档在
//              真实数据下暂时不可达；⛔ 但**不许**因此把它从这张表里删掉——下一个类别
//              （`automation` v1.1、还空着的 `sandbox.health`）落地前照样有那段窗口。
//              它今天的现场是 `AuditStreamCard.view.stories.tsx` 的 CategoryNotYetEmitted。
//
// ⚠️ **第五个形状：「实时更新已中断」是一行，不是一块**（§3A ⑦）。增量轮询挂掉时历史方向
// 往往还是好的，用整块错误态盖住已有列表，等于把一次轮询失败放大成整个面板不可用。
// 但也**不许什么都不显示**——那是「静默停止更新伪装成没有新事件」，与 ⑥ 是同一个谎。
//
// ⚠️ **翻页 footer 不属于"有行"那个分支**：服务端筛完之后 `rows` 可能为空而 `hasOlder`
// 仍为 true（更老的那一页里才有匹配行）。footer 被关在 `rows.length > 0` 里的那一版，
// 用户看到的是"当前筛选无匹配记录"**且没有任何继续加载的入口**，读出来的结论是"没有"。
import { Fragment, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AuditEventRowView } from '@/views/system/AuditEventRow.view';
import { AuditGapNoticeView } from '@/views/system/AuditGapNotice.view';
import type { AuditEmptyKind, AuditGap, AuditRowModel } from '@/types/audit';

const SKELETON_ROWS = 5;

/**
 * 三个空态的**主句**。⚠️ 三句互不相同、且**互不覆盖**：查表出一句，
 * 不是"叠一句新的"——两句同时渲染时肯定断言照样绿，只有否定断言看得见。
 */
const EMPTY_HEADLINE: Readonly<Record<AuditEmptyKind, string>> = {
  'no-records': '暂无记录',
  'filtered-out': '当前筛选无匹配记录',
  'category-not-yet-emitted': '该类事件平台尚未记录',
};

export interface AuditStreamCardProps {
  rows: AuditRowModel[];
  isPending: boolean;
  isError: boolean;
  /** 筛选条（由容器装配 `AuditFilterBarView`）。 */
  filterBar: ReactNode;
  /**
   * 空列表**为什么**空（lib 判定，三态互不相同的文案）。
   * ⛔ 别退回布尔：两态装不下三个事实。
   */
  emptyKind: AuditEmptyKind;
  /** 空态里那句「当前筛选条件」（lib 算好）。 */
  filterSummary: string;
  /** 增量通道挂了（§3A ⑦）：顶部挂一行提示，⛔ 不盖住列表。 */
  isLiveUpdateError: boolean;
  gap: AuditGap | null;
  /** 断层提示插在第几行**之前**（lib 算好；`null` = 不插）。 */
  gapIndex: number | null;
  isFillingGap: boolean;
  hasOlder: boolean;
  isFetchingOlder: boolean;
  expandedSeq: number | null;
  onToggleDetail: (seq: number) => void;
  onOpenTimeline: (subjectId: string) => void;
  onFillGap: () => void;
  onReachEnd: () => void;
  onRetry: () => void;
  /** 只重试增量通道（不重拉历史页）。 */
  onRetryLiveUpdate: () => void;
  onClearFilters: () => void;
  onExport: () => void;
}

export function AuditStreamCardView({
  rows,
  isPending,
  isError,
  isLiveUpdateError,
  filterBar,
  emptyKind,
  filterSummary,
  gap,
  gapIndex,
  isFillingGap,
  hasOlder,
  isFetchingOlder,
  expandedSeq,
  onToggleDetail,
  onOpenTimeline,
  onFillGap,
  onReachEnd,
  onRetry,
  onRetryLiveUpdate,
  onClearFilters,
  onExport,
}: AuditStreamCardProps) {
  return (
    <section
      aria-labelledby="audit-stream-heading"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="audit-stream-heading" className="text-base font-semibold">
          🧾 审计流
        </h2>
        {/* [导出日志] 的规格归属 DiagnosticsCard（§3），本切片里诊断卡尚未落地，
            先挂在这里；导出物是后端打的 tar.gz，前端不解析、也不自己标注截取范围。 */}
        <Button type="button" size="sm" variant="outline" onClick={onExport}>
          导出日志
        </Button>
      </header>

      {filterBar}

      {!isError && isLiveUpdateError && (
        <div
          role="status"
          data-testid="audit-live-update-error"
          className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/5 px-3 py-1.5 text-xs"
        >
          <span aria-hidden="true">⚠️</span>
          <span>实时更新已中断，列表可能不是最新的</span>
          <Button type="button" size="sm" variant="ghost" onClick={onRetryLiveUpdate}>
            重试
          </Button>
        </div>
      )}

      {isError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-md border border-red-500/50 bg-red-500/5 p-4 text-sm"
        >
          <span>❌ 审计流加载失败</span>
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            重试
          </Button>
        </div>
      ) : isPending ? (
        <ul aria-busy="true" aria-label="审计流加载中" className="flex flex-col gap-1.5">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <li
              key={i}
              data-testid="audit-skeleton-row"
              className="h-6 animate-pulse rounded bg-muted/50"
            />
          ))}
        </ul>
      ) : (
        <>
          {rows.length === 0 ? (
            <div
              data-testid="audit-empty"
              data-empty-kind={emptyKind}
              className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground"
            >
              <p>{EMPTY_HEADLINE[emptyKind]}</p>
              <p className="text-xs">{filterSummary}</p>
              {emptyKind === 'category-not-yet-emitted' && (
                /* ⚠️ 这一句才是重点：把"没筛到"与"没记过"分开。缺了它，用户会去调
                   严重度和时间范围——而调到天荒地老也不会有一条记录出来。 */
                <p className="text-xs">
                  平台目前不会为该类别写入审计事件；这不代表相关操作没有发生。
                </p>
              )}
              {emptyKind !== 'no-records' && (
                <Button type="button" size="sm" variant="outline" onClick={onClearFilters}>
                  清除筛选
                </Button>
              )}
            </div>
          ) : (
            <ul className="flex flex-col">
              {rows.map((row, index) => (
                <Fragment key={row.seq}>
                  {gap !== null && gapIndex === index && (
                    <AuditGapNoticeView
                      afterSeq={gap.afterSeq}
                      beforeSeq={gap.beforeSeq}
                      filling={isFillingGap}
                      onFill={onFillGap}
                    />
                  )}
                  <AuditEventRowView
                    row={row}
                    expanded={expandedSeq === row.seq}
                    onToggleDetail={onToggleDetail}
                    onOpenTimeline={onOpenTimeline}
                  />
                </Fragment>
              ))}
              {gap !== null && gapIndex === rows.length && (
                <AuditGapNoticeView
                  afterSeq={gap.afterSeq}
                  beforeSeq={gap.beforeSeq}
                  filling={isFillingGap}
                  onFill={onFillGap}
                />
              )}
            </ul>
          )}

          {/* ⚠️ 空列表 + `hasOlder` 也要给入口（见文件头末条）；空列表 + 到底则什么都不加，
              让空态那句话自己站着——在一片空白下面写「已到最早记录」只会更让人犯嘀咕。 */}
          {(rows.length > 0 || hasOlder) && (
            <div className="flex justify-center pt-1 text-xs text-muted-foreground">
              {hasOlder ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isFetchingOlder}
                  onClick={onReachEnd}
                >
                  {isFetchingOlder ? '加载中…' : '加载更早的记录'}
                </Button>
              ) : (
                <span>已到最早记录</span>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
