// 通用二次确认弹层（F21-3 §5「模式切换确认」用；受影响 Task 的吊销确认另有 RevokeConfirmDialog）。
// 纯展示、props 驱动、零副作用。
import { Button } from '@/components/ui/button';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialogView({
  title,
  message,
  confirmLabel = '确认',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{message}</p>
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onCancel}>
            取消
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={onConfirm}>
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
