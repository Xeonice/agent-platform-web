// 选中规则的配置详情 + 动作 + 运行历史（F21-7 §3）。纯展示。
//
// 删除动作由容器切到同一个对话框里的 DeleteAutomationConfirm 视图（REQ-AUT-024）。
import type { RefObject } from 'react';
import { AlertTriangle, Check, Square, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RunHistoryListView } from '@/views/project/RunHistoryList.view';
import type { AutomationRow, RunRow } from '@/types/automation';

/** 与 `AutomationListItem.view` 同一张表（`row.status` → 图标/颜色，复用 StatusPill 三态）。 */
const STATUS_ICON: Record<'ok' | 'warn' | 'fail', LucideIcon> = {
  ok: Check,
  warn: AlertTriangle,
  fail: X,
};
const STATUS_ICON_CLASS: Record<'ok' | 'warn' | 'fail', string> = {
  ok: 'text-success',
  warn: 'text-warning',
  fail: 'text-error',
};

function LifecycleIcon({ status }: { status: AutomationRow['status'] }) {
  if (status === undefined) {
    return (
      <Square
        aria-hidden="true"
        data-testid="detail-lifecycle-icon"
        data-lifecycle-status="off"
        className="h-4 w-4 shrink-0 fill-current text-muted-foreground"
      />
    );
  }
  const Icon = STATUS_ICON[status];
  return (
    <Icon
      aria-hidden="true"
      data-testid="detail-lifecycle-icon"
      data-lifecycle-status={status}
      className={`h-4 w-4 shrink-0 ${STATUS_ICON_CLASS[status]}`}
    />
  );
}

export interface AutomationDetailProps {
  row: AutomationRow;
  focusRegionRef?: RefObject<HTMLElement | null>;
  /** 配置摘要（runtime / 调度 / 超时 / 保留期 / webhook），由 container 组装好。 */
  configLines: { label: string; value: string }[];
  /** 任务内容预览（前若干字符）。⚠️ 完整 prompt 只在编辑表单里展开。 */
  promptPreview: string;
  busy?: boolean;
  actionErrorMessage?: string;
  runs: {
    rows: RunRow[];
    previewRows: RunRow[];
    loading: boolean;
    loadErrorMessage?: string;
    hasMore: boolean;
    loadingMore: boolean;
  };
  /** 从列表的 [查看原因] 进来 ⇒ 运行历史里最近一次算失败的那条**自动展开**。 */
  focusLatestFailure?: boolean;
  onBack: () => void;
  onEdit: (id: string) => void;
  onToggle: (id: string, next: boolean) => void;
  onDelete: (id: string) => void;
  onLoadMoreRuns: () => void;
  onRetryRuns?: () => void;
  onViewArtifacts?: (sandboxId: string) => void;
  onOpenTask?: (sandboxId: string) => void;
}

export function AutomationDetailView({
  row,
  focusRegionRef,
  configLines,
  promptPreview,
  busy = false,
  actionErrorMessage,
  runs,
  focusLatestFailure = false,
  onBack,
  onEdit,
  onToggle,
  onDelete,
  onLoadMoreRuns,
  onRetryRuns,
  onViewArtifacts,
  onOpenTask,
}: AutomationDetailProps) {
  const enabled = row.lifecycle !== 'off' && row.lifecycle !== 'autoDisabled';

  return (
    <div
      className="max-h-[calc(85dvh-64px)] overflow-y-auto flex flex-col gap-4 px-5 py-4 text-sm"
      data-testid="automation-detail"
    >
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="detail-back">
          ← 返回列表
        </Button>
      </div>

      <div>
        <h3 className="flex items-center gap-1.5 text-base font-semibold">
          <LifecycleIcon status={row.status} />
          {row.name}
        </h3>
        <p
          className={`mt-0.5 text-xs ${row.needsAttention ? 'text-amber-500' : 'text-muted-foreground'}`}
          data-testid="detail-status"
        >
          {row.statusText}
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs" data-testid="detail-config">
        {configLines.map((line) => (
          <div key={line.label} className="contents">
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd className="break-words">{line.value}</dd>
          </div>
        ))}
      </dl>

      <div>
        <p className="text-xs text-muted-foreground">任务内容</p>
        <pre
          className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 text-[11px]"
          tabIndex={0}
          role="region"
          aria-label="任务内容预览"
          data-testid="detail-prompt"
        >
          {promptPreview}
        </pre>
      </div>

      {actionErrorMessage !== undefined && actionErrorMessage !== '' && (
        <p role="alert" className="text-xs text-red-400" data-testid="detail-action-error">
          {actionErrorMessage}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            onEdit(row.id);
          }}
          data-testid="detail-edit"
        >
          编辑
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            onToggle(row.id, !enabled);
          }}
          data-testid="detail-toggle"
        >
          {row.lifecycle === 'autoDisabled' ? '重新开启' : enabled ? '关掉' : '开启'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-error"
          disabled={busy}
          onClick={() => {
            onDelete(row.id);
          }}
          data-testid="detail-delete"
        >
          删除
        </Button>
      </div>

      <RunHistoryListView
        rows={runs.rows}
        {...(focusRegionRef === undefined ? {} : { focusRegionRef })}
        {...(onRetryRuns === undefined ? {} : { onRetry: onRetryRuns })}
        {...(onViewArtifacts === undefined ? {} : { onViewArtifacts })}
        previewRows={runs.previewRows}
        loading={runs.loading}
        {...(runs.loadErrorMessage === undefined
          ? {}
          : { loadErrorMessage: runs.loadErrorMessage })}
        hasMore={runs.hasMore}
        loadingMore={runs.loadingMore}
        focusLatestFailure={focusLatestFailure}
        onLoadMore={onLoadMoreRuns}
        {...(onOpenTask === undefined ? {} : { onOpenTask })}
      />
    </div>
  );
}
