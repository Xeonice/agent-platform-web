// 运行历史的一行（P21-7 §3.3 / F21-7 §6）。纯展示。
//
// ★ **这一行要回答的是「这次到底发生了什么」，不是「好还是坏」。**
//   8 个 status 在 `lib/automation/formatRunOutcome` 里先收敛成 6 个 category，
//   这里按 category 上色 + 明写「这次算不算一次失败」。
//   ⚠️ 那句「这次不算失败」不是装饰：`missed`（平台调度当时没在跑而错过）和 `skipped`
//   （凭证过期 / 上次没跑完）在没有它的时候，会和 ❌ 失败一起被读成"我的规则一直在挂"，
//   而这三件事该做的处置完全不同。⚠️ 但它的**视觉权重**要比"算一次失败"低一档，
//   理由见下面那段注释。
import { AlertTriangle, Check, Circle, Loader2, Minus, X, type LucideIcon } from 'lucide-react';
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

/**
 * `outcome.category` → 图标（07 §4.1：lib 只给 `category` 这个语义字段，这里是唯一
 * 决定"画哪个 lucide 图标"的地方）。图标选择尽量对齐 `StatusPill` 的八态同款：
 * success→ok(Check)、failure→fail(X)、skipped→skipped(Minus)。
 * `waiting`/`running` 统一用 `Loader2`（转）——两者都是"还没有结果"，与 `StatusPill`
 * 的 `pending` 态同一个图标；`missed` 用 `Circle`（`StatusPill` 的 `unknown` 态同款）：
 * ⚠️ **这不是完美匹配**——`missed` 说的是"平台没跑"，`unknown` 字面意思是"不知道"，
 * 两者不完全是一回事，八态里确实没有专门表达"错过"的一态。选它是因为它是八态里
 * 视觉权重最轻、最不像"警告/失败"的一个，与 `missed` 文案"这不是规则的问题、
 * 不算失败"的语气最接近。交付报告已把这处判断单独列出来，供拍板。
 */
const CATEGORY_ICON: Record<RunOutcomeCategory, LucideIcon> = {
  success: Check,
  failure: X,
  skipped: Minus,
  missed: Circle,
  waiting: Loader2,
  running: Loader2,
};

const CATEGORY_SPINS: ReadonlySet<RunOutcomeCategory> = new Set(['waiting', 'running']);

export function RunHistoryItemView({
  row,
  expanded = false,
  onToggleDetail,
  onOpenTask,
}: RunHistoryItemProps) {
  const { outcome } = row;
  const OutcomeIcon = CATEGORY_ICON[outcome.category];
  return (
    <li
      className="rounded border border-border px-3 py-2"
      data-testid="run-history-item"
      data-category={outcome.category}
      data-counts-toward-failure={String(outcome.countsTowardFailure)}
    >
      <div className="flex items-center gap-2">
        <OutcomeIcon
          aria-hidden="true"
          data-testid="run-outcome-icon"
          data-outcome-category={outcome.category}
          className={`h-3.5 w-3.5 shrink-0 ${CATEGORY_CLASS[outcome.category]} ${
            CATEGORY_SPINS.has(outcome.category) ? 'animate-spin' : ''
          }`}
        />
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

      {/*
        ★ 「算不算失败」：区分四类结果的**硬判据**，每一行都给，⛔ 不折叠、不省略。
        ⚠️ 但两支的**视觉权重刻意不同**：一屏十条里有九条写着"这次不算失败"，
           同样的颜色会让这一行整体沦为背景噪音，连那一条真的失败也一起被略过去。
           算失败的那支保留常规次要色 + ⚠️；不算的那支再降一档 —— 它要的是"扫到时能看见"，
           不是"每一行都来抢一次注意力"。⛔ 降的是权重，不是这句话本身。
      */}
      <p
        className={`mt-1 text-[11px] ${
          outcome.countsTowardFailure ? 'text-muted-foreground' : 'text-muted-foreground/60'
        }`}
        data-testid="run-failure-accounting"
      >
        {outcome.countsTowardFailure && (
          <AlertTriangle aria-hidden="true" className="mr-1 inline h-3 w-3 text-warning" />
        )}
        {outcome.countsTowardFailure ? '这次算一次失败' : '这次不算失败'}
      </p>

      {expanded && (
        <div className="mt-2 flex flex-col gap-2 border-t border-border pt-2">
          <p className="text-xs text-muted-foreground" data-testid="run-detail">
            {outcome.detail}
          </p>
          {/*
            ★ 后端给的失败原因原文。**带标签、次要样式**，与 `outputSummary` 同一档：
              它是机器写给排查用的（英文 / 异常 message），⛔ 不是人话文案——
              上面那句 `outcome.detail` 才是。两者都要：一句说"这属于哪一类失败"，
              一条说"到底哪一步炸的"。此前这一条解析了却从不渲染，失败原因永远只有通用话。
          */}
          {row.errorMessage !== undefined && row.errorMessage !== '' && (
            <div data-testid="run-error-message">
              <p className="text-[11px] text-muted-foreground">失败信息（后端原文）</p>
              <pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 text-[11px] text-red-300">
                {row.errorMessage}
              </pre>
            </div>
          )}
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
                打开任务
              </Button>
              <span className="ml-2 text-[11px] text-muted-foreground">
                这是自动跑的任务，右侧只能看输出，不能敲命令。
              </span>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
