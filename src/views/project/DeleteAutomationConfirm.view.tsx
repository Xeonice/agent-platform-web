import { Button } from '@/components/ui/button';
import type { AutomationDeletionPreviewDto } from '@/types/automation';

export interface DeleteAutomationConfirmProps {
  name: string;
  nextTriggerText?: string;
  preview?: AutomationDeletionPreviewDto;
  busy: boolean;
  errorMessage?: string;
  onCancel: () => void;
  onDelete: () => void;
}

/** A view in the existing automation dialog, never a nested dialog. */
export function DeleteAutomationConfirmView({
  name,
  nextTriggerText,
  preview,
  busy,
  errorMessage,
  onCancel,
  onDelete,
}: DeleteAutomationConfirmProps) {
  return (
    <div
      className="flex max-h-[calc(85dvh-64px)] min-h-0 flex-col text-sm"
      data-testid="detail-delete-confirm"
    >
      <div className="min-h-0 flex-1 overflow-y-auto space-y-4 px-5 py-4">
        <section>
          <h3 className="font-medium">会删掉</h3>
          <p>
            这条规则「{name}」，以及它的
            {preview === undefined ? '全部运行历史' : `${String(preview.runCount)} 次运行历史`}
            ；之后不会再按时触发
            {nextTriggerText === undefined ? '。' : `（原定下次 ${nextTriggerText}）。`}
          </p>
        </section>
        <section>
          <h3 className="font-medium">删掉之后</h3>
          <p>拿不回来；要接着跑，只能重新建一条规则。</p>
        </section>
        <section>
          <h3 className="font-medium">不受影响</h3>
          <p>
            已经由它发起、还保留着的成果与任务
            {preview === undefined
              ? '仍然保留'
              : `（${String(preview.artifactCount)} 份运行成果仍在「保留下来的成果」里）`}
            ，到期自动清理，到期之前都可以下载。
          </p>
          {preview?.runningTasks.map((task) => (
            <p key={task.id}>正在跑的任务「{task.name}」不会被中断，会跑完。</p>
          ))}
          {preview === undefined && <p>正在跑的任务不会被中断，会跑完。</p>}
        </section>
        <p className="text-xs text-muted-foreground">
          清单来源：后端返回（规则详情、运行记录数、保留成果列表、正在跑的运行）。
        </p>
      </div>
      <footer className="shrink-0 border-t border-border px-5 py-3">
        {errorMessage !== undefined && (
          <p role="alert" className="mb-2 text-xs text-error">
            {errorMessage}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            autoFocus
            disabled={busy}
            onClick={onCancel}
            data-testid="detail-delete-confirm-no"
          >
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={onDelete}
            data-testid="detail-delete-confirm-yes"
          >
            {busy ? '正在删除…' : '删除规则'}
          </Button>
        </div>
      </footer>
    </div>
  );
}
