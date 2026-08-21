// 吊销二次确认弹层（F21-3 §3/§5，唯一允许的二级弹层）：受影响运行中 Task 清单（最多 10 条 +「等共 N 个」）+
// **P0-4 延迟语义文案**（吊销会重启运行实例；已泄漏的 token 无法追回）+ 生效中模式额外警示。纯展示、props 驱动。
import { Button } from '@/components/ui/button';
import type { AffectedTaskItem } from '@/types/runtimeCredential';

export interface RevokeConfirmDialogProps {
  runtimeName: string;
  modeLabel: string;
  /** 受影响运行中 Task（前 10 条）。 */
  affectedItems: AffectedTaskItem[];
  /** 超出 10 条的剩余数（>0 → 「等共 N 个」）。 */
  restCount: number;
  /** **P0-4 延迟语义文案**（与后端 05 §4 同源，必现）。 */
  warningText: string;
  /** 吊销的是否为当前生效模式（额外提示「该模式将不可用」，F21-3 §5）。 */
  warnActiveMode?: boolean;
  revoking?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RevokeConfirmDialogView({
  runtimeName,
  modeLabel,
  affectedItems,
  restCount,
  warningText,
  warnActiveMode = false,
  revoking = false,
  onConfirm,
  onCancel,
}: RevokeConfirmDialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`吊销 ${runtimeName} ${modeLabel}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <h3 className="text-base font-semibold">
          吊销 {runtimeName} · {modeLabel}？
        </h3>

        {/* P0-4：延迟语义必现，不能给「吊销即刻失效、无残留」的错觉。 */}
        <p role="alert" className="text-sm text-amber-400">
          {warningText}
        </p>

        {warnActiveMode && (
          <p className="text-xs text-muted-foreground">该模式当前生效，吊销后将不可用。</p>
        )}

        {affectedItems.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">受影响的运行中任务（将被重启）：</span>
            <ul className="list-inside list-disc text-xs">
              {affectedItems.map((item) => (
                <li key={item.id}>{item.name}</li>
              ))}
              {restCount > 0 && <li>等共 {affectedItems.length + restCount} 个</li>}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">当前无运行中的任务使用该凭证。</p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={revoking} onClick={onCancel}>
            取消
          </Button>
          <Button type="button" size="sm" disabled={revoking} onClick={onConfirm}>
            {revoking ? '吊销中…' : '确认吊销'}
          </Button>
        </div>
      </div>
    </div>
  );
}
