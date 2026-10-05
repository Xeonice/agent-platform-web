import { AlertTriangle, Gift, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RetainedVolumeRow, RetainedVolumeTotals } from '@/types/retainedVolume';

export interface RetainedVolumesPanelProps {
  projectName: string;
  rows: RetainedVolumeRow[];
  totals: RetainedVolumeTotals;
  loading: boolean;
  loadErrorMessage?: string;
  actionErrorMessage?: string;
  deletingId?: string | null;
  confirmingRow?: RetainedVolumeRow | null;
  projectTaskCount?: number;
  groupTotals?: Record<string, RetainedVolumeTotals>;
  projects?: { id: string; name: string }[];
  scope?: string | null;
  allowScope?: boolean;
  focusSandboxId?: string | null;
  retrying?: boolean;
  archiveUrl: (id: string) => string;
  onDelete: (id: string) => void;
  onRequestDelete?: (id: string) => void;
  onCancelDelete?: () => void;
  onScopeChange?: (id: string | null) => void;
  onRetry?: () => void;
}
const SIZE_LEGEND =
  '「占用」是宿主磁盘实占（删掉能拿回的空间）；「下载」是打包成 tar 的大小（.gitignore 命中的不打包，.git 保留）。';
export function RetainedVolumesPanelView({
  projectName,
  rows,
  totals,
  loading,
  loadErrorMessage,
  actionErrorMessage,
  deletingId = null,
  confirmingRow = null,
  projectTaskCount = 0,
  groupTotals = {},
  projects = [],
  scope = null,
  allowScope = false,
  focusSandboxId,
  retrying = false,
  archiveUrl,
  onDelete,
  onRequestDelete,
  onCancelDelete,
  onScopeChange,
  onRetry,
}: RetainedVolumesPanelProps) {
  if (confirmingRow !== null)
    return (
      <section
        className="flex flex-col gap-4 px-5 py-4 text-sm"
        data-testid="retained-volume-confirm"
      >
        <h3 className="font-semibold">删除成果「{confirmingRow.originText}」？</h3>
        <div>
          <p className="text-xs text-muted-foreground">会删掉</p>
          <p>这份代码副本（占用 {confirmingRow.diskText}）</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">删掉之后</p>
          <p>拿不回来；先下载一份，再决定是否删除。</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">不受影响</p>
          <p>
            同项目里另外{' '}
            {Math.max(0, (groupTotals[confirmingRow.projectId ?? '']?.count ?? totals.count) - 1)}{' '}
            份成果
          </p>
          <p>
            {projects.find((project) => project.id === confirmingRow.projectId)?.name ??
              projectName}{' '}
            本身，以及它的 {projectTaskCount} 个任务
          </p>
        </div>
        {actionErrorMessage && (
          <p role="alert" className="text-error">
            {actionErrorMessage}
          </p>
        )}
        <div className="mt-2 flex justify-between gap-2">
          <Button
            autoFocus
            variant="outline"
            disabled={deletingId !== null}
            onClick={onCancelDelete}
          >
            取消
          </Button>
          <Button
            className="bg-error text-white"
            disabled={deletingId !== null}
            onClick={() => {
              onDelete(confirmingRow.id);
            }}
          >
            {deletingId !== null && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            {deletingId !== null ? '删除中…' : '删除成果'}
          </Button>
        </div>
      </section>
    );
  const projectIds = Array.from(new Set(rows.map((row) => row.projectId ?? '')));
  return (
    <div className="flex flex-col gap-4 px-5 py-4 text-sm" data-testid="retained-volumes-panel">
      {allowScope && (
        <label className="flex items-center gap-2 text-xs">
          范围
          <select
            className="min-w-0 flex-1 rounded border border-border bg-background p-2"
            value={scope ?? ''}
            onChange={(event) => onScopeChange?.(event.target.value || null)}
          >
            <option value="">全部项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-xs text-muted-foreground">
        {scope === null && allowScope ? '全部项目' : projectName}{' '}
        保留下来的成果：销毁任务时选择留下的那份代码副本。到期后由后台自动清理。
      </p>
      {loading && (
        <p
          role="status"
          className="text-xs text-muted-foreground"
          data-testid="retained-volumes-loading"
        >
          正在读取…
        </p>
      )}
      {loadErrorMessage && (
        <div role="alert">
          <p className="font-medium text-error">没能读出保留下来的成果</p>
          <p className="mt-1 text-xs text-muted-foreground">{loadErrorMessage}</p>
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            disabled={retrying}
            onClick={onRetry}
          >
            {retrying && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}重试
          </Button>
        </div>
      )}
      {!loading && !loadErrorMessage && rows.length === 0 && (
        <div
          className="rounded border border-dashed border-border px-3 py-6 text-center"
          data-testid="retained-volumes-empty"
        >
          <Gift aria-hidden="true" className="mx-auto mb-3 size-6 text-muted-foreground" />
          <p>
            {allowScope && scope === null
              ? '还没有保留下来的成果。'
              : '这个项目还没有保留下来的成果。'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            销毁任务时选择把代码副本留下来，那份副本就会出现在这里，可以下载，也可以手动删掉。
          </p>
        </div>
      )}
      {rows.length > 0 && !loadErrorMessage && (
        <>
          <p className="text-xs text-muted-foreground" data-testid="retained-volumes-totals">
            共 {totals.count} 个 · 占用 {totals.diskText} · 全部下载 {totals.downloadText}
          </p>
          {projectIds.map((id) => (
            <section key={id} className="flex flex-col gap-2">
              {allowScope && scope === null && (
                <h3 className="flex flex-wrap justify-between gap-2 text-xs font-medium">
                  <span>
                    {projects.find((project) => project.id === id)?.name ?? '来源项目已删除'}
                  </span>
                  <span className="text-muted-foreground">
                    {groupTotals[id]?.count ?? 0} 个 · 占用 {groupTotals[id]?.diskText ?? '—'}
                  </span>
                </h3>
              )}
              <ul className="flex flex-col gap-2">
                {rows
                  .filter((row) => (row.projectId ?? '') === id)
                  .map((row) => (
                    <li
                      key={row.id}
                      id={`retained-${row.id}`}
                      data-testid="retained-volume-row"
                      className={`flex flex-col gap-2 rounded-lg border px-3 py-3 ${focusSandboxId === row.sandboxId ? 'border-ring bg-muted/30' : 'border-border'}`}
                    >
                      <div className="flex items-center gap-2">
                        <Gift aria-hidden="true" className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate" title={row.sandboxId}>
                          {row.originText}
                        </span>
                        {row.countdownText && (
                          <span
                            data-testid="retained-volume-countdown"
                            className={`flex shrink-0 items-center gap-1 text-xs ${row.urgent ? 'text-warning' : 'text-muted-foreground'}`}
                          >
                            {row.urgent && (
                              <AlertTriangle aria-hidden="true" className="size-3.5" />
                            )}
                            {row.countdownText}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {row.sourceText} · 保留于 {row.retainedAtText}
                      </p>
                      <p className="text-xs" data-testid="retained-volume-sizes">
                        占用 <span className="font-mono">{row.diskText}</span> · 下载{' '}
                        <span className="font-mono">{row.downloadText}</span>
                      </p>
                      <div className="flex items-center gap-2">
                        <a
                          href={archiveUrl(row.id)}
                          download
                          data-testid="retained-volume-download"
                          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs hover:bg-muted"
                        >
                          下载（{row.downloadText}）
                        </a>
                        <Button
                          data-retained-delete={row.id}
                          variant="ghost"
                          size="sm"
                          disabled={deletingId === row.id}
                          onClick={() => {
                            (onRequestDelete ?? onDelete)(row.id);
                          }}
                        >
                          {deletingId === row.id ? '删除中…' : '删除'}
                        </Button>
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          <p className="text-xs leading-relaxed text-muted-foreground">{SIZE_LEGEND}</p>
        </>
      )}
      {actionErrorMessage && (
        <p role="alert" className="text-xs text-error">
          {actionErrorMessage}
        </p>
      )}
    </div>
  );
}
