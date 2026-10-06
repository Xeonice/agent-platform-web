// 三级验证结论以 StatusPill 和后果说明展示，警告带 warnings，失败带 errors 与查看要求入口。
// 保存动作由注册弹窗负责；HEADLINE 只展示细节，避免重复 pill 中的结论词。
import { StatusPill, type StatusPillStatus } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import type { ImageValidationResultData } from '@/types/image';

export interface ValidationResultProps extends ImageValidationResultData {
  /** ❌ 时的唯一出路（P22 §1：禁止只报错不给动作）。 */
  onViewRequirements?: () => void;
  requirementsOpen?: boolean;
}

const HEADLINE: Record<ImageValidationResultData['status'], string> = {
  valid: '镜像可用',
  // ⚠️「仍可用」这三个字不能省：⚠️ 档的产品语义是**验证通过了**、只是有需要注意的地方
  //（`lib/image/imageManifestCards.ts` 的注释专门强调过这一点）。pill 只说「有警告」，
  // 不说"还能不能用" —— 那正是用户看到黄色时第一个要问的。
  warning: '镜像仍可用',
  invalid: '镜像不符合平台约定',
};

/** 验证结论的 pill 短标签。 */
const PILL_LABEL: Record<ImageValidationResultData['status'], string> = {
  valid: '验证通过',
  warning: '有警告',
  invalid: '无效',
};

/** 验证结论映射：通过 ok、有警告 warn、无效 fail。 */
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
  unknownCodes = [],
  requirementsOpen = false,
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

      {unknownCodes.map((code) => (
        <p key={code} className="font-mono text-xs text-muted-foreground">
          错误码：{code}
        </p>
      ))}
      {status === 'invalid' && onViewRequirements !== undefined && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={requirementsOpen}
            onClick={onViewRequirements}
          >
            查看镜像要求
          </Button>
        </div>
      )}
    </div>
  );
}
