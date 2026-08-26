// 三级验证结论 ✅/⚠️/❌（P21-4 §5/§9，F21-4 §3）。纯展示、props 驱动、零副作用。
//
// P21-4 §9 的硬要求：**每级都要给后果说明，不裸报技术词**。所以 ⚠️ 一定带 warnings、
// ❌ 一定带 errors + [查看镜像要求] 出路（同 P22 §1「发生了什么 + 现在能做什么」）。
//
// ⚠️ 这里**没有** [保存]：能不能保存是注册弹窗的事（`RegisterImageModal.view`），
// 结论区只负责说清楚结论。把两件事塞进一个组件，就会出现"结论已作废但保存还在"的缝。
import { Button } from '@/components/ui/button';
import type { ImageValidationResultData } from '@/types/image';

export interface ValidationResultProps extends ImageValidationResultData {
  /** ❌ 时的唯一出路（P22 §1：禁止只报错不给动作）。 */
  onViewRequirements?: () => void;
}

const HEADLINE: Record<ImageValidationResultData['status'], string> = {
  valid: '✅ 验证通过：镜像可用',
  warning: '⚠️ 验证通过但有警告',
  invalid: '❌ 验证失败：镜像不符合平台约定',
};

/** ⚠️ 是黄、❌ 是红、✅ 是绿——三级各自一个色，别混。 */
const TONE_CLASS: Record<ImageValidationResultData['status'], string> = {
  valid: 'border-emerald-500/40 text-emerald-400',
  warning: 'border-amber-500/40 text-amber-400',
  invalid: 'border-red-500/40 text-red-400',
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
      className={`flex flex-col gap-2 rounded-md border p-3 text-sm ${TONE_CLASS[status]}`}
    >
      <p className="font-medium">{HEADLINE[status]}</p>

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
