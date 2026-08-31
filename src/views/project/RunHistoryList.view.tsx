// 运行历史列表（P21-7 §3.3：最近 10 条 + [查看全部]，每页 20）。纯展示。
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RunHistoryItemView } from '@/views/project/RunHistoryItem.view';
import type { RunRow } from '@/types/automation';

export interface RunHistoryListProps {
  /** 全部已加载行（展开后显示）。 */
  rows: RunRow[];
  /** 折叠态的最近 10 条。 */
  previewRows: RunRow[];
  loading: boolean;
  loadErrorMessage?: string;
  hasMore: boolean;
  loadingMore: boolean;
  /** 展开全部 + 继续翻页。 */
  onLoadMore: () => void;
  onOpenTask?: (sandboxId: string) => void;
}

export function RunHistoryListView({
  rows,
  previewRows,
  loading,
  loadErrorMessage,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpenTask,
}: RunHistoryListProps) {
  const [showAll, setShowAll] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const visible = showAll ? rows : previewRows;

  return (
    <section className="flex flex-col gap-2" data-testid="run-history">
      <div className="flex items-baseline gap-2">
        <h4 className="text-sm font-semibold">运行历史</h4>
        {/*
          ⚠️ 只有**翻到底**才敢说「共」。游标分页拿不到总数（后端刻意不回 —— append-only
          流的总数每刻都在变，回它等于让这里显示一个过期的数），所以还有下一页时说的是
          「已加载 N 次」。⛔ 拿已加载条数去填「共 N 次」是撒谎，那正是这个项目最忌讳的。
        */}
        <span className="text-xs text-muted-foreground" data-testid="run-history-total">
          {hasMore ? `已加载 ${String(rows.length)} 次` : `共 ${String(rows.length)} 次`}
        </span>
      </div>

      {loading && (
        <p className="text-xs text-muted-foreground" data-testid="run-history-loading">
          正在读取运行历史…
        </p>
      )}

      {loadErrorMessage !== undefined && loadErrorMessage !== '' && (
        <p role="alert" className="text-xs text-red-400" data-testid="run-history-error">
          {loadErrorMessage}
        </p>
      )}

      {!loading && loadErrorMessage === undefined && rows.length === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="run-history-empty">
          这条规则还没有运行过。到点触发后，每一次的结果都会记在这里。
        </p>
      )}

      {visible.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {visible.map((row) => (
            <RunHistoryItemView
              key={row.id}
              row={row}
              expanded={row.id === expandedId}
              onToggleDetail={(id) => {
                setExpandedId((prev) => (prev === id ? null : id));
              }}
              {...(onOpenTask === undefined ? {} : { onOpenTask })}
            />
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        {!showAll && rows.length > previewRows.length && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowAll(true);
            }}
            data-testid="run-history-show-all"
          >
            查看全部
          </Button>
        )}
        {/* 折叠态也允许直接 [查看全部]：那一下同时展开并去拉下一页。 */}
        {!showAll && rows.length <= previewRows.length && hasMore && (
          <Button
            variant="ghost"
            size="sm"
            disabled={loadingMore}
            onClick={() => {
              setShowAll(true);
              onLoadMore();
            }}
            data-testid="run-history-show-all"
          >
            查看全部
          </Button>
        )}
        {showAll && hasMore && (
          <Button
            variant="ghost"
            size="sm"
            disabled={loadingMore}
            onClick={onLoadMore}
            data-testid="run-history-load-more"
          >
            {loadingMore ? '加载中…' : '加载更多'}
          </Button>
        )}
      </div>
    </section>
  );
}
