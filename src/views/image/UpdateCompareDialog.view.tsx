// [检查更新] 的新旧 digest 对比弹层（P21-4 §5 ★/§6，F21-4 §3/§5）。纯展示、props 驱动、零副作用。
//
// 它回答的是「这个 **tag** 现在还指向它吗」——与 [重新验证]（「这个 **digest** 还合格吗」）是两件事。
// **不自动切换**：新旧 digest 摆出来 + 新版本的三级结论，用户点 [更新到新版本] 才写。
//
// ⚠️ **新版本判定为 ❌ 时不渲染 [更新到新版本]**（P21-4 §5 ★）——
// 一次检查不该把一张正在好好用着的镜像变成不能用的。这条落成 story 的 play 否定断言。
import { Button } from '@/components/ui/button';
import { ValidationResultView } from '@/views/image/ValidationResult.view';
import type { ImageValidationResultData } from '@/types/image';

export interface UpdateCompareDialogProps {
  imageName: string;
  /** tag 形态的坐标（digest 形态根本走不到这里——[检查更新] 已置灰）。 */
  refDisplay: string;
  /** 当前钉定的 digest 短串。 */
  currentDigestShort: string;
  /** 「解析于 3 天前」；缺席则整行不渲染。 */
  currentResolvedAtLabel?: string;
  /** 上游该 tag 现在指向的 digest 短串。 */
  upstreamDigestShort: string;
  /** 上游新版本的三级结论（服务端判定，前端猜不出来 ⇒ 这里也不做乐观更新）。 */
  upstreamValidation: ImageValidationResultData;
  updating?: boolean;
  onAdopt: () => void;
  /** [暂不更新]：**保留当前 digest**。 */
  onDismiss: () => void;
  onViewRequirements?: () => void;
}

export function UpdateCompareDialogView({
  imageName,
  refDisplay,
  currentDigestShort,
  currentResolvedAtLabel,
  upstreamDigestShort,
  upstreamValidation,
  updating = false,
  onAdopt,
  onDismiss,
  onViewRequirements,
}: UpdateCompareDialogProps) {
  const upstreamUsable = upstreamValidation.status !== 'invalid';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${imageName} 的上游更新`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="flex w-full max-w-xl flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <h3 className="text-base font-semibold">🔄 上游有新版本</h3>
        <p className="font-mono text-xs text-muted-foreground">{refDisplay}</p>

        <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2" data-testid="current-digest">
            <span className="text-muted-foreground">当前</span>
            <span className="font-mono">{currentDigestShort}</span>
            {currentResolvedAtLabel !== undefined && (
              <span className="text-muted-foreground">（{currentResolvedAtLabel}）</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2" data-testid="upstream-digest">
            <span className="text-muted-foreground">上游</span>
            <span className="font-mono text-sky-400">{upstreamDigestShort}</span>
          </div>
        </div>

        <ValidationResultView
          {...upstreamValidation}
          {...(onViewRequirements === undefined ? {} : { onViewRequirements })}
        />

        {!upstreamUsable && (
          <p className="text-xs text-muted-foreground" data-testid="kept-current-version">
            上游新版本不满足平台约定，<strong className="font-medium">已保留当前版本</strong>。
          </p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={updating} onClick={onDismiss}>
            暂不更新
          </Button>
          {/* 新版本 ❌ ⇒ **不渲染**（不是渲染出来再置灰）。 */}
          {upstreamUsable && (
            <Button type="button" size="sm" disabled={updating} onClick={onAdopt}>
              {updating ? '更新中…' : '更新到新版本'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
