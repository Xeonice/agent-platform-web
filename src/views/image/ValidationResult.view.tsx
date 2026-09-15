// 三级验证结论 ✅/⚠️/❌（P21-4 §5/§9，F21-4 §3）。纯展示、props 驱动、零副作用。
//
// P21-4 §9 的硬要求：**每级都要给后果说明，不裸报技术词**。所以 ⚠️ 一定带 warnings、
// ❌ 一定带 errors + [查看镜像要求] 出路（同 P22 §1「发生了什么 + 现在能做什么」）。
//
// ⚠️ 这里**没有** [保存]：能不能保存是注册弹窗的事（`RegisterImageModal.view`），
// 结论区只负责说清楚结论。把两件事塞进一个组件，就会出现"结论已作废但保存还在"的缝。
//
// ⚠️ v3 原型收口（design-notes.md Phase 6 / prototype.html #images ①）：这一条从
// "自制的带边框条"（手写 TONE_CLASS 边框色）改成"一行 StatusPill + 一句话"——颜色/
// 图标交给 `StatusPill` 统一管（八态对照表见 status-pill.tsx），这里不再自己维护
// 一套边框色。
//
// ⚠️⚠️ **`HEADLINE` 只放「细节」那一半，结论词归 pill**。产品文档 P21-4 §5 写的是
// 「✅ 验证通过：镜像可用」这种「结论：细节」句式 —— 当时结论由 emoji 旁边的文字承担。
// 换成 pill 之后 pill 自己就带文字（八态体系要求"图标 + 文字 + 颜色三重线索"，
// design-notes 问题 2），如果 HEADLINE 仍保留整句，屏幕上就会念两遍：
//   ⛔ `[✓ 验证通过] 验证通过：镜像可用`
//   ✅ `[✓ 验证通过] 镜像可用`
// **信息一个字没少**（结论 + 细节都还在），只是结论从句子里搬进了 pill。
// ⛔ 不要把「验证通过 / 验证失败」这类结论词写回 HEADLINE —— 下面那条 story
// 断言（结论词全页只出现一次）会红。
import { StatusPill, type StatusPillStatus } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import type { ImageValidationResultData } from '@/types/image';

export interface ValidationResultProps extends ImageValidationResultData {
  /** ❌ 时的唯一出路（P22 §1：禁止只报错不给动作）。 */
  onViewRequirements?: () => void;
}

const HEADLINE: Record<ImageValidationResultData['status'], string> = {
  valid: '镜像可用',
  // ⚠️「仍可用」这三个字不能省：⚠️ 档的产品语义是**验证通过了**、只是有需要注意的地方
  //（`lib/image/imageManifestCards.ts` 的注释专门强调过这一点）。pill 只说「有警告」，
  // 不说"还能不能用" —— 那正是用户看到黄色时第一个要问的。
  warning: '镜像仍可用',
  invalid: '镜像不符合平台约定',
};

/** pill 短标签——字面抄自 prototype.html #images 区块的 `.status-pill` 文案。 */
const PILL_LABEL: Record<ImageValidationResultData['status'], string> = {
  valid: '验证通过',
  warning: '有警告',
  invalid: '无效',
};

/** 结论 → StatusPill 八态之三（design-notes.md Phase 6：「通过→ok、有警告→warn、无效→fail」）。 */
const PILL_STATUS: Record<ImageValidationResultData['status'], StatusPillStatus> = {
  valid: 'ok',
  warning: 'warn',
  invalid: 'fail',
};

export function ValidationResultView({
  status,
  warnings = [],
  errors = [],
  pinnedDigestShort,
  onViewRequirements,
}: ValidationResultProps) {
  return (
    <div
      data-testid="validation-result"
      data-status={status}
      role={status === 'invalid' ? 'alert' : 'status'}
      className="flex flex-col gap-2 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={PILL_STATUS[status]} data-testid="validation-status-pill">
          {PILL_LABEL[status]}
        </StatusPill>
        <span className="text-muted-foreground">{HEADLINE[status]}</span>
      </div>

      {/* 「这个绿勾属于这个 digest，不属于这个 tag」（P21-4 §5 ★）——所以结论旁边就把 digest 摆出来。 */}
      {pinnedDigestShort !== undefined && status !== 'invalid' && (
        <p className="font-mono text-xs text-muted-foreground" data-testid="pinned-digest">
          钉定 {pinnedDigestShort}
        </p>
      )}

      {warnings.length > 0 && (
        <ul
          className="flex list-disc flex-col gap-1 pl-5 text-xs"
          data-testid="validation-warnings"
        >
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {errors.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-xs" data-testid="validation-errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {status === 'invalid' && onViewRequirements !== undefined && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={onViewRequirements}>
            查看镜像要求
          </Button>
        </div>
      )}
    </div>
  );
}
