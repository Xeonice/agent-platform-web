import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
export interface DestroyTaskConfirmProps {
  detailsLoading?: boolean;
  name: string;
  preparing: boolean;
  canKeep: boolean;
  keep: boolean;
  busy: boolean;
  error?: string;
  onKeep: (keep: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}
export function DestroyTaskConfirmView({
  detailsLoading = false,
  name,
  preparing,
  canKeep,
  keep,
  busy,
  error,
  onKeep,
  onCancel,
  onConfirm,
}: DestroyTaskConfirmProps) {
  return (
    <div className="space-y-5 p-6 text-sm">
      <section>
        <h3 className="mb-2 font-medium">会删掉</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>{preparing ? '准备到一半的运行环境' : '这个任务的运行环境'}</li>
          <li>任务「{name}」的记录</li>
        </ul>
      </section>
      {detailsLoading && <p role="status">正在读取任务状态…</p>}
      <fieldset disabled={busy || detailsLoading} className="space-y-2">
        <legend className="mb-2 font-medium">代码副本怎么处理</legend>
        {canKeep ? (
          <>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="task-volume"
                checked={keep}
                onChange={() => {
                  onKeep(true);
                }}
              />
              <span>留下来作为成果（默认；30 天后自动清理，可在「保留下来的成果」里下载）</span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="task-volume"
                checked={!keep}
                onChange={() => {
                  onKeep(false);
                }}
              />
              <span>一起删掉，不留成果</span>
            </label>
          </>
        ) : (
          <p>{preparing ? '一起删掉，不留成果' : '一起删掉（没有成果可留）'}</p>
        )}
      </fieldset>
      <section>
        <h3 className="mb-2 font-medium">删掉之后</h3>
        <p>占用的任务名额会释放，可以马上重新发起。</p>
      </section>
      <section>
        <h3 className="mb-2 font-medium">不受影响</h3>
        <p>项目代码，以及同项目的其他任务。</p>
      </section>
      <p className="text-xs text-muted-foreground">清单来源：当前任务的状态与代码副本。</p>
      {error !== undefined && (
        <p role="alert" className="text-error">
          {error}
        </p>
      )}
      {busy && <p role="status">正在删除任务…</p>}
      <div className="flex justify-between gap-3">
        <Button autoFocus data-dialog-cancel="" variant="ghost" disabled={busy} onClick={onCancel}>
          取消
        </Button>
        <Button variant="destructive" disabled={busy || detailsLoading} onClick={onConfirm}>
          {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          {preparing ? '取消并删除' : '销毁任务'}
        </Button>
      </div>
    </div>
  );
}
