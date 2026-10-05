import type { RefObject } from 'react';
import { Button } from '@/components/ui/button';

export interface PresetDisableDialogProps {
  reference: string;
  version: string;
  busy: boolean;
  dialogRef?: RefObject<HTMLDivElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}

export function PresetDisableDialogView({
  reference,
  version,
  busy,
  dialogRef,
  onConfirm,
  onCancel,
}: PresetDisableDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-disable-title"
        aria-describedby="preset-disable-consequence"
        className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-border bg-background p-6 shadow-lg"
      >
        <div>
          <h3 id="preset-disable-title" className="break-all text-lg font-semibold">
            禁用预制镜像「{reference}」？
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            平台预制镜像 · 当前版本 {version} · 已启用
          </p>
        </div>
        <p
          id="preset-disable-consequence"
          className="text-sm leading-relaxed text-muted-foreground"
        >
          在重新启用之前，用它的新任务都会在发起时被拒：新建任务默认用它，自动化规则到点发起的任务也用它。要接着发任务：重新启用它，或者在新建任务里换一张已启用的镜像。已经在跑的任务不受影响；随时可以在这张卡上点
          [启用] 恢复。
        </p>
        <div className="flex justify-end gap-2">
          <Button autoFocus variant="ghost" disabled={busy} onClick={onCancel}>
            取消
          </Button>
          <Button variant="outline" disabled={busy} onClick={onConfirm}>
            {busy ? '禁用中…' : '禁用'}
          </Button>
        </div>
      </div>
    </div>
  );
}
