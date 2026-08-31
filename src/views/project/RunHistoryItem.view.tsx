// 运行历史的一行（P21-7 §3.3 / F21-7 §6）。纯展示。
//
// ★ **这一行要回答的是「这次到底发生了什么」，不是「好还是坏」。**
//   8 个 status 在 `lib/automation/formatRunOutcome` 里先收敛成 6 个 category，
//   这里按 category 上色 + 明写「计入/不计入连续失败」。
//   ⚠️ 那句「不计入连续失败」不是装饰：`missed`（调度器宕机错过）和 `skipped`（凭证过期 /
//   上次没跑完）在没有它的时候，会和 ❌ 失败一起被读成"我的规则一直在挂"，
//   而这三件事该做的处置完全不同。
import { Button } from '@/components/ui/button';
import type { RunOutcomeCategory, RunRow } from '@/types/automation';

export interface RunHistoryItemProps {
  row: RunRow;
  expanded?: boolean;
  onToggleDetail: (id: string) => void;
  /** 只有 run 带得出 sandboxId 才渲染（契约暂缺时不摆一个点了没反应的按钮）。 */
  onOpenTask?: (sandboxId: string) => void;
}

/** category → 配色。**语义分三档**：坏（红）/ 没跑（灰）/ 在路上（琥珀）/ 好（绿）。 */
const CATEGORY_CLASS: Record<RunOutcomeCategory, string> = {
  success: 'text-emerald-500',
  failure: 'text-red-400',
  // ⚠️ skipped 与 missed 刻意**不用红色**：它们不是失败，用红色等于在界面上撒谎。
  skipped: 'text-muted-foreground',
  missed: 'text-muted-foreground',
  waiting: 'text-amber-500',
  running: 'text-sky-400',
};

export function RunHistoryItemView({
  row,
  expanded = false,
  onToggleDetail,
  onOpenTask,
}: RunHistoryItemProps) {
  const { outcome } = row;
  return (
    <li
      className="rounded border border-border px-3 py-2"
      data-testid="run-history-item"
      data-category={outcome.category}
      data-counts-toward-failure={String(outcome.countsTowardFailure)}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true">{outcome.icon}</span>
        <span
          className={`text-xs font-medium ${CATEGORY_CLASS[outcome.category]}`}
          data-testid="run-label"
        >
          {outcome.label}
        </span>
        <span className="text-xs text-muted-foreground" data-testid="run-started-at">
          {row.startedAtText}
        </span>
        {row.durationText !== undefined && (
          <span className="text-xs text-muted-foreground" data-testid="run-duration">
            耗时 {row.durationText}
          </span>
        )}
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onToggleDetail(row.id);
          }}
          data-testid="run-toggle-detail"
        >
          {expanded ? '收起' : '详情'}
        </Button>
      </div>

      {/* ★ 计入/不计入连续失败：区分四类结果的**硬判据**，每一行都给，不折叠。 */}
      <p className="mt-1 text-[11px] text-muted-foreground" data-testid="run-failure-accounting">
        {outcome.countsTowardFailure ? '⚠️ 计入连续失败计数' : '不计入连续失败计数'}
      </p>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
          <p className="text-xs text-muted-foreground" data-testid="run-detail">
            {outcome.detail}
          </p>
          {row.webhookNote !== undefined && (
            <p className="text-[11px] text-muted-foreground" data-testid="run-webhook-note">
              {row.webhookNote}
            </p>
          )}
          {row.outputSummary !== undefined && row.outputSummary !== '' && (
            <pre
              className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 text-[11px]"
              data-testid="run-output-summary"
            >
              {row.outputSummary}
            </pre>
          )}
          {row.sandboxId !== undefined && onOpenTask !== undefined && (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onOpenTask(row.sandboxId ?? '');
                }}
                data-testid="run-open-task"
              >
                打开 Task
              </Button>
              <span className="ml-2 text-[11px] text-muted-foreground">
                无头任务，右侧是只读输出，不是可交互终端。
              </span>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
