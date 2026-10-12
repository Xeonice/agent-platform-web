import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { ContractFinalizeDisplay } from '@/types/upgrade';
export interface ContractFinalizeProps {
  model: ContractFinalizeDisplay;
  busy: boolean;
  message?: string | null;
  confirmationOpen: boolean;
  onConfirmationOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}
/** Display-only. Eligibility and the independent command come from the server. */
export function ContractFinalizeView({
  model,
  busy,
  message = null,
  confirmationOpen,
  onConfirmationOpenChange,
  onConfirm,
}: ContractFinalizeProps) {
  if (!model.visible) return null;
  return (
    <section aria-labelledby="contract-finalize-heading" className="mt-4 space-y-2 border-t pt-3">
      <h3 id="contract-finalize-heading" className="text-sm font-medium">
        旧数据格式清理
      </h3>
      <p className="text-xs text-muted-foreground">{model.status}</p>
      {message === null ? null : (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
      {model.reason === null ? null : (
        <p className="text-xs text-muted-foreground">{model.reason}</p>
      )}
      <dl className="space-y-1 text-xs">
        {model.facts.map((fact) => (
          <div key={fact.label} className="flex flex-wrap justify-between gap-x-3">
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd className="break-all">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {model.canExecute ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            onConfirmationOpenChange(true);
          }}
        >
          清理旧数据格式
        </Button>
      ) : null}
      <Dialog open={confirmationOpen} onOpenChange={onConfirmationOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认清理旧数据格式</DialogTitle>
            <DialogDescription>
              这一步单独提交清理请求。服务端会重新核验回退窗口已结束、旧版本读者已退休、数据对账一致，随后停用旧数据表示并继续使用当前格式。
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">清理完成后，使用旧数据格式的历史版本无法重新接流。</p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                onConfirmationOpenChange(false);
              }}
            >
              取消
            </Button>
            <Button disabled={busy || !model.canExecute} onClick={onConfirm}>
              {busy ? '正在确认清理请求…' : '确认清理'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
