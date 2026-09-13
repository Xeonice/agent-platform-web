// 诊断卡（F21-5 §3/§5/§5A · P21-5 §6/§9A/§9B）。纯展示、props 驱动、零副作用。
//
// ⚠️ **八项占位来自 props（服务端首帧），不是本地常量。** 未开始时这里是空的 —— 那时
// 服务端还没说过清单，画八行灰条等于凭本地抄本编一份界面。开始之后 `items` 恒八项、
// 恒固定顺序，已完成项立刻定格、未完成项 ⏳（P21-5 §6「异步并行但展示顺序固定」）。
//
// ⚠️ **[重新诊断] 是这张卡上唯一会被禁用的东西。** 诊断运行中**不阻塞其它区域**
// （F21-5 §4）：这里不产出遮罩、不 disable 别的卡片，甚至同一张卡上的 [导出日志] 也照常可点。
//
// ⚠️ **中断时已到达项一条不清。** 「诊断中断」是挂在结果**上方**的一行，不是盖住结果的
// 一块 —— 把七项已经查出来的结论连同中断一起抹掉，等于让一次网络抖动没收用户刚拿到的
// 全部信息（F21-5 §8）。
//
// ⚠️ **schema hash 对不上只提示、不拦截**：诊断的使用场景是「系统好像坏了」，
// 因版本不匹配而中断一次只读诊断，等于在最需要它的时候把它关掉。
//
// ⚠️ **八项共用一个 `Accordion type="multiple"`，展开集合是受控的**
// （design/design-notes.md §1 问题 1 + §4 Phase 1 第一条）。「非 ok/info 默认展开」
// 的判定与 override 计算住在 `lib/system/diagnosticsDisclosure.ts`，经
// `hooks/system/useDiagnosticsDisclosure.ts` 接到 `SystemStatusContainer`——本文件
// **不 import lib**（分层铁律：`view` 只能 `allow: ['view','type','component']`），
// `openIds`/`onOpenIdsChange` 就是两个普通 prop，这里只管照给定的 `openIds` 渲染。
import { AlertTriangle, Info } from 'lucide-react';
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
          服务端诊断帧版本为 {schemaMismatch}，与本前端认识的版本不同 ——
          已认识的项照常显示，建议升级前端；⛔ 不因此中断诊断
        </p>
      )}

      {model.abortedText === undefined ? null : (
        <p
          role="alert"
          data-testid="diagnose-aborted"
          className="flex items-center gap-1.5 text-sm text-red-500"
        >
          <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
          {model.abortedText} —— 已到达的结果保留在下方，可点 [重新诊断] 重跑
        </p>
      )}

      {model.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
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
      ) : (
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
      )}

      {model.summaryText === undefined ? null : (
        <p data-testid="diagnose-summary" className="text-xs text-muted-foreground">
          {model.summaryText}
        </p>
      )}
    </section>
  );
}
