// 选中规则的配置详情 + 动作 + 运行历史（F21-7 §3）。纯展示。
//
// ⚠️ **删除的二次确认就地展开，不叠第二层弹层**（P20 §8.4 modal 不堆叠 / F21-7 §2）：
//   本面板自己就活在一层 `ModalShell` 里，再套一个 dialog 就是两层。
//   与 `RetainedVolumesPanel.view` 的处理一致（那里的删除确认也是就地展开）。
//   ⇒ F21-7 §3 组件树里的 `DeleteRuleConfirm.view` 因此**没有作为独立弹层组件落地**，
//     它的职责在本文件内的 `confirming` 分支里，交付报告已列出这处偏离。
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RunHistoryListView } from '@/views/project/RunHistoryList.view';
import type { AutomationRow, RunRow } from '@/types/automation';

export interface AutomationDetailProps {
  row: AutomationRow;
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
  onBack: () => void;
  onEdit: (id: string) => void;
  onToggle: (id: string, next: boolean) => void;
  onDelete: (id: string) => void;
  onLoadMoreRuns: () => void;
  onOpenTask?: (sandboxId: string) => void;
}

export function AutomationDetailView({
  row,
  configLines,
  promptPreview,
  busy = false,
  actionErrorMessage,
  runs,
  onBack,
  onEdit,
  onToggle,
  onDelete,
  onLoadMoreRuns,
  onOpenTask,
}: AutomationDetailProps) {
  const [confirming, setConfirming] = useState(false);
  const enabled = row.lifecycle !== 'off' && row.lifecycle !== 'autoDisabled';

  return (
    <div className="flex flex-col gap-4 px-5 py-4 text-sm" data-testid="automation-detail">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="detail-back">
          ← 返回列表
        </Button>
      </div>

      <div>
        <h3 className="flex items-center gap-1.5 text-base font-semibold">
          <span aria-hidden="true">{row.icon}</span>
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
          {row.lifecycle === 'autoDisabled' ? '重新启用' : enabled ? '禁用' : '启用'}
        </Button>
        {!confirming && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setConfirming(true);
            }}
            data-testid="detail-delete"
          >
            删除
          </Button>
        )}
      </div>

      {confirming && (
        <div
          className="rounded border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs"
          data-testid="detail-delete-confirm"
        >
          <p>删除「{row.name}」？运行历史会一并删除，且不可恢复。</p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                onDelete(row.id);
              }}
              data-testid="detail-delete-confirm-yes"
            >
              确认删除
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfirming(false);
              }}
              data-testid="detail-delete-confirm-no"
            >
              取消
            </Button>
          </div>
        </div>
      )}

      <RunHistoryListView
        rows={runs.rows}
        previewRows={runs.previewRows}
        loading={runs.loading}
        {...(runs.loadErrorMessage === undefined
          ? {}
          : { loadErrorMessage: runs.loadErrorMessage })}
        hasMore={runs.hasMore}
        loadingMore={runs.loadingMore}
        onLoadMore={onLoadMoreRuns}
        {...(onOpenTask === undefined ? {} : { onOpenTask })}
      />
    </div>
  );
}
