import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
export interface DeleteProjectConfirmProps {
  projectName: string;
  taskCount: number;
  runningTaskCount: number;
  cloning: boolean;
  busy?: boolean;
  loading?: boolean;
  loadError?: boolean;
  activeTasks?: { id: string; name: string; statusLabel?: string }[];
  taskNames?: string[];
  allTasksStopped?: boolean;
  retainedNames?: string[];
  retainedCount?: number;
  automationCount?: number;
  baselineText?: string;
  cloneDownloadedText?: string;
  errorMessage?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onGoTasks?: () => void;
  onGoRetained?: () => void;
  onCancelClone?: () => void;
  onRetryPreview?: () => void;
}
export function DeleteProjectConfirmView({
  projectName,
  taskCount,
  runningTaskCount,
  cloning,
  busy = false,
  loading = false,
  loadError = false,
  activeTasks = [],
  taskNames = [],
  allTasksStopped = false,
  retainedNames = [],
  retainedCount = 0,
  automationCount = 0,
  baselineText,
  cloneDownloadedText,
  errorMessage,
  onConfirm,
  onCancel,
  onGoTasks,
  onGoRetained,
  onCancelClone,
  onRetryPreview,
}: DeleteProjectConfirmProps) {
  const activeCount = activeTasks.length || runningTaskCount;
  const blocked = activeCount > 0 || retainedCount > 0 || loading || loadError;
  const reason = loading
    ? '正在读取删除清单'
    : loadError
      ? '先重新读取删除清单'
      : `先${activeCount ? `停止或销毁上面 ${String(activeCount)} 个任务` : ''}${activeCount && retainedCount ? '，并' : ''}${retainedCount ? `清理 ${String(retainedCount)} 份成果` : ''}`;
  return (
    <section data-testid="delete-project-confirm" className="flex flex-col gap-4 px-5 py-4 text-sm">
      {loading && <p role="status">正在读取删除清单…</p>}
      {loadError && (
        <div role="alert">
          <p>没能读出删除清单，请重试。</p>
          <Button variant="outline" onClick={onRetryPreview}>
            重试
          </Button>
        </div>
      )}
      {cloning && (
        <div
          className="rounded-lg border border-border bg-muted/30 p-3"
          data-testid="delete-cloning-note"
        >
          <p className="font-medium">这个项目正在克隆</p>
          <p className="mt-1 text-xs text-muted-foreground">
            删除会先停掉这次克隆，再把项目一起删掉。如果你只是想停下这次克隆、把项目留着，用这个：
          </p>
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onCancelClone}
          >
            取消克隆（保留项目）
          </Button>
        </div>
      )}
      {(activeCount > 0 || retainedCount > 0) && (
        <div
          className="rounded-lg border border-warning/40 bg-warning/5 p-3"
          data-testid="delete-running-warning"
        >
          <h3 className="font-medium">
            {activeCount
              ? `请先停止或销毁 ${String(activeCount)} 个还在活动的任务`
              : `请先清理 ${String(retainedCount)} 份保留下来的成果`}
          </h3>
          {activeCount > 0 && (
            <>
              <ul className="mt-2 text-xs">
                {activeTasks.map((task) => (
                  <li key={task.id}>
                    {task.name} · {task.statusLabel ?? '还在活动'}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-2"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={onGoTasks}
              >
                去停止或销毁
              </Button>
            </>
          )}
          {retainedCount > 0 && (
            <>
              <p className="mt-3 text-xs">
                还有 {retainedCount} 份保留下来的成果没清理
                {retainedNames.length ? `：${retainedNames.join('、')}` : ''}（也可以等
                {retainedCount > 1 ? '它们' : '它'}到期自动清理）
              </p>
              <Button
                className="mt-2"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={onGoRetained}
              >
                去清理
              </Button>
            </>
          )}
        </div>
      )}
      <dl className="flex flex-col gap-4" data-testid="delete-cascade-copy">
        <div>
          <dt className="text-xs text-muted-foreground">
            {blocked && !loading && !loadError ? '处理完之后，会删掉' : '会删掉'}
          </dt>
          <dd>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {cloning ? (
                <>
                  <li>
                    正在进行的这次克隆：先停掉，已经下载的 {cloneDownloadedText ?? '代码'} 直接丢弃
                  </li>
                  <li>项目「{projectName}」本身（还没有任务、保留成果和自动化规则）</li>
                </>
              ) : (
                <>
                  {taskCount > 0 && (
                    <li>
                      {activeCount
                        ? `这个项目下剩下的任务和它们的代码副本（现在共 ${String(taskCount)} 个）`
                        : `${String(taskCount)} 个任务和它们的代码副本${taskNames.length ? `：${taskNames.join('、')}（${allTasksStopped ? '都已停止' : '都已停止或异常'}）` : ''}`}
                    </li>
                  )}
                  <li>这台机器上的仓库副本{baselineText ? `（${baselineText}）` : ''}</li>
                  {automationCount > 0 && <li>{automationCount} 条自动化规则，以及它的运行历史</li>}
                </>
              )}
            </ul>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">删掉之后</dt>
          <dd>拿不回来；要再用这个仓库，只能重新建项目、重新克隆。</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">不受影响</dt>
          <dd>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>远端 Git 仓库不受影响（代码和提交历史都不动）</li>
              <li>其它项目，以及它们的任务和成果</li>
            </ul>
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        清单来源：平台返回的任务列表、保留成果列表、自动化规则。
      </p>
      {busy && <p role="status">正在删除项目「{projectName}」…</p>}
      {errorMessage && (
        <div role="alert" className="text-error" data-testid="delete-error">
          <p>{errorMessage}</p>
          <p className="mt-1 text-xs">
            项目原样保留，什么都没删；网络恢复后可以再点一次「删除项目」。
          </p>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-3">
        <Button
          variant="outline"
          disabled={busy}
          data-testid="delete-cancel"
          data-dialog-cancel=""
          onClick={onCancel}
        >
          取消
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          {blocked && (
            <p id="project-delete-reason" className="text-xs text-muted-foreground">
              {reason}
            </p>
          )}
          <Button
            disabled={busy}
            aria-disabled={blocked}
            aria-describedby={blocked ? 'project-delete-reason' : undefined}
            data-testid="delete-confirm"
            className="shrink-0 bg-error text-white aria-disabled:opacity-50"
            onClick={() => {
              if (!blocked) onConfirm();
            }}
          >
            {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            {busy ? '删除中…' : '删除项目'}
          </Button>
        </div>
      </div>
    </section>
  );
}
