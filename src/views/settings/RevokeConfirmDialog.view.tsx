// 删除二次确认弹层（F21-3 §3/§5，唯一允许的二级弹层）：会被重启的任务清单（最多 10 条 +「等共 N 个」）+
// **P0-4 延迟语义文案**（删除会重启正在跑的任务；已外流的 token 平台删不掉）+ 当前在用的额外警示。
// 纯展示、props 驱动。
import { Button } from '@/components/ui/button';
import type { AffectedTaskItem } from '@/types/runtimeCredential';

export interface RevokeConfirmDialogProps {
  runtimeName: string;
  modeLabel: string;
  /** 会被重启的任务（前 10 条）。 */
  affectedItems: AffectedTaskItem[];
  /** 超出 10 条的剩余数（>0 → 「等共 N 个」）。 */
  restCount: number;
  /**
   * 这份清单**算不算得出来**。
   *
   * ⛔ 本弹层最要紧的一位。`false` 时 `affectedItems` 同样是空数组，但那是「查不到」不是「没有」——
   *    把它渲染成「当前没有任务在跑」，就是在一个**不可逆操作**的确认框上撒谎。
   *    此前这个弹层没有这一位，而上游恒传空数组，于是那句「当前无运行中的任务使用该凭证」
   *    **在任何情况下都出现**，包括真有 10 个任务正在跑的时候。
   */
  affectedKnown?: boolean;
  /** **P0-4 延迟语义文案**（与后端 05 §4 同源，必现）。 */
  warningText: string;
  /** P0-4 的下一步（去厂商后台作废）。次要行，但必须有——只有断言没有出路等于制造焦虑。 */
  followUpText?: string;
  /** 删除的是否为当前在用的那一份（额外提示，F21-3 §5）。 */
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
  affectedKnown = true,
  warningText,
  followUpText,
  warnActiveMode = false,
  revoking = false,
  onConfirm,
  onCancel,
}: RevokeConfirmDialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`删除 ${runtimeName} 的${modeLabel}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <h3 className="text-base font-semibold">
          删除 {runtimeName} 的{modeLabel}？
        </h3>

        {/* P0-4：延迟语义必现，不能给「删掉就即刻失效、无残留」的错觉。 */}
        <p role="alert" className="text-sm text-amber-400">
          {warningText}
        </p>
        {followUpText !== undefined && followUpText !== '' && (
          <p className="text-xs text-muted-foreground">{followUpText}</p>
        )}

        {warnActiveMode && (
          <p className="text-xs text-muted-foreground">
            这个 Agent 现在用的就是它，删掉就不能用了。
          </p>
        )}

        {!affectedKnown ? (
          // 「不知道」不能说成「没有」：查不到清单时把不确定性交给用户，而不是替他下结论。
          <p role="status" className="text-xs text-amber-400" data-testid="affected-unknown">
            正在跑的任务清单暂时查不到，删除前请自行确认。
          </p>
        ) : affectedItems.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">这些正在跑的任务会被重启：</span>
            <ul className="list-inside list-disc text-xs">
              {affectedItems.map((item) => (
                <li key={item.id}>{item.name}</li>
              ))}
              {restCount > 0 && <li>等共 {affectedItems.length + restCount} 个</li>}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">现在没有任务在用这份凭证。</p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={revoking} onClick={onCancel}>
            取消
          </Button>
          <Button type="button" size="sm" disabled={revoking} onClick={onConfirm}>
            {revoking ? '删除中…' : '确认删除'}
          </Button>
        </div>
      </div>
    </div>
  );
}
