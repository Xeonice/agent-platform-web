// 诊断清单来自服务端首帧，未开始时不使用本地占位项编造清单。
// 运行中仅禁用重新诊断；中断保留已到达结果。schema hash 不一致只提示，不阻断只读诊断。
// Accordion 多项展开集合由 hook 计算，再以 openIds/onOpenIdsChange 受控 props 传入。
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import { Accordion } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { DiagnosticItemView } from '@/views/system/DiagnosticItem.view';
import type { DiagnosticsCardModel } from '@/types/system';

export interface DiagnosticsCardProps {
  model: DiagnosticsCardModel;
  isDiagnosing: boolean;
  /** 服务端 `X-Schema-Hash` 与前端认识的对不上；`null` = 一致或未知。 */
  schemaMismatch: string | null;
  /** 当前应该展开的那几项 id（`useDiagnosticsDisclosure` 算好）。 */
  openIds: string[];
  /** 接 Accordion 的 `onValueChange`：用户手动展开/收起时回传完整的新数组。 */
  onOpenIdsChange: (nextOpenIds: string[]) => void;
  onDiagnose: () => void;
  onExportLogs: () => void;
  /** 命令 [复制]（clipboard + toast 在 container）。 */
  onCopyHint: (hint: string) => void;
}

export function DiagnosticsCardView({
  model,
  isDiagnosing,
  schemaMismatch,
  openIds,
  onOpenIdsChange,
  onDiagnose,
  onExportLogs,
  onCopyHint,
}: DiagnosticsCardProps) {
  return (
    <section
      aria-labelledby="diagnostics-heading"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="diagnostics-heading" className="text-base font-semibold">
          诊断
        </h2>
        <span className="flex items-center gap-2">
          <Button type="button" size="sm" disabled={isDiagnosing} onClick={onDiagnose}>
            {isDiagnosing ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
            {isDiagnosing ? '诊断中…' : '重新诊断'}
          </Button>
          {/* ⚠️ 诊断运行中它照常可点：非阻塞是产品要求，不是"顺便"。 */}
          <Button type="button" size="sm" variant="outline" onClick={onExportLogs}>
            导出日志
          </Button>
        </span>
      </header>

      {schemaMismatch === null ? null : (
        <p role="status" className="flex items-center gap-1.5 text-xs text-amber-600">
          <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          诊断格式已更新（版本 {schemaMismatch}），结果照常显示，建议升级前端。
        </p>
      )}

      {model.abortedText === undefined ? null : (
        <p
          role="alert"
          data-testid="diagnose-aborted"
          className="flex items-center gap-1.5 text-sm text-red-500"
        >
          <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
          {model.abortedText}
        </p>
      )}

      {model.summaryText === undefined ? null : (
        <p role="status" data-testid="diagnose-summary" className="text-sm text-muted-foreground">
          {model.summaryText}
        </p>
      )}

      {model.items.length === 0 && model.phase !== 'aborted' ? (
        <p
          role={model.phase === 'running' ? 'status' : undefined}
          className="text-sm text-muted-foreground"
        >
          {model.phase === 'running'
            ? '正在连接诊断流…（检查清单由服务端下发）'
            : // ⛔ **不写死秒数。** 上一版写「单项 5s 超时」，而后端的
              //    `DIAGNOSE_TIMEOUT_MS` 早已是 10s —— 一个抄在界面上的常量必然漂移，
              //    而它对用户的下一个动作没有任何区别（等就是了）。真实预算由服务端
              //    在首帧 `start.timeoutMs` 里下发，⚠️ 前端不自行计时（F21-5 §7.1 ②）。
              //    第 ⑤ 项到达之后会自己带上这句话（读的是同一份配置，见
              //    `DiagnosticItemView` 的 `timeoutText`），这里的空态文案不需要抢先说。
              '尚未运行。点 [重新诊断] 跑一轮：各项并行，某一项超时也不阻塞其余项。'}
        </p>
      ) : model.items.length > 0 ? (
        <Accordion
          type="multiple"
          value={openIds}
          onValueChange={onOpenIdsChange}
          className="flex flex-col gap-2"
        >
          {model.items.map((item, index) => (
            <DiagnosticItemView
              key={item.id}
              item={item}
              ordinal={index + 1}
              expanded={openIds.includes(item.id)}
              onCopyHint={onCopyHint}
            />
          ))}
        </Accordion>
      ) : null}
    </section>
  );
}
