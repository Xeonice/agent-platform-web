import { Button } from '@/components/ui/button';
import { AppDialogView } from '@/views/common/AppDialog.view';

export interface ConfirmDialogProps {
  title: string;
  subtitle?: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialogView({
  title,
  subtitle,
  message,
  confirmLabel = '确认',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <AppDialogView
      title={title}
      subtitle={subtitle}
      onClose={onCancel}
      busy={busy}
      testId="credential-mode-confirm"
    >
      <p className="px-5 py-4 text-sm text-muted-foreground">{message}</p>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
        <Button
          autoFocus
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={onCancel}
        >
          取消
        </Button>
        <Button type="button" size="sm" disabled={busy} onClick={onConfirm}>
          {busy ? '切换中…' : confirmLabel}
        </Button>
      </footer>
    </AppDialogView>
  );
}
