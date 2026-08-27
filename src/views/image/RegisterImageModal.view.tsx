// 注册新镜像弹窗（P21-4 §3/§6，F21-4 §2/§5）。纯展示、props 驱动、零副作用。
//
// **必须是真 overlay**（F21-4 §2「加回来的两个条件」之二）：`role=dialog` + `fixed inset-0 z-50 …
// bg-black/60`，与 `ConfirmDialog.view` 同一套形态。`'createProject'` 曾经挂在 currentModal 上
// 却被渲染成主区换页——名字是假的；这一轮刚把它兑现，这里守同一形态，别再让它变假。
//
// ⚠️ **[保存] 只在有结论且结论不是 ❌ 时才渲染**（不是"渲染出来再 disabled"）：
// P21-4 §5 说的是「✅/⚠️ 出现 [保存]」。
//
// ⚠️ **结论作废是"清掉"不是"隐藏"**：容器判定 `uri.trim() !== validatedUri` 后把 `result` 整个清空
// 并置 `conclusionInvalidated`，本组件因此**根本拿不到**上一次的绿勾与 digest。
// 留着它等"万一改回来"，就是留着一个随时可能与当前输入不符的绿勾——正是这条交互要消灭的东西。
import { Button } from '@/components/ui/button';
import { ValidationResultView } from '@/views/image/ValidationResult.view';
import type { ImageValidationResultData } from '@/types/image';

export interface RegisterImageModalProps {
  uri: string;
  onUriChange: (next: string) => void;
  onValidate: () => void;
  onSave: () => void;
  onCancel: () => void;
  /** [验证] 进行中（后端 60s 超时，按钮 loading 覆盖全程）。 */
  validating?: boolean;
  /** [保存] 进行中。 */
  saving?: boolean;
  /** 本次验证结论；**改动 URI 后由容器整块清掉**（见文件头）。 */
  result?: ImageValidationResultData;
  /** 上一次的结论已被本次输入作废 ⇒ 灰字「已修改镜像地址，请重新验证」。 */
  conclusionInvalidated?: boolean;
  /** URI 形状的前端实时校验错误。 */
  uriError?: string;
  /**
   * 该 ref 已注册。**不当错误吓唬用户**（P21-4 §6）：就地提示 + [定位到该镜像]。
   */
  duplicate?: { message: string };
  onLocateExisting?: () => void;
  onViewRequirements?: () => void;
}

export function RegisterImageModalView({
  uri,
  onUriChange,
  onValidate,
  onSave,
  onCancel,
  validating = false,
  saving = false,
  result,
  conclusionInvalidated = false,
  uriError,
  duplicate,
  onLocateExisting,
  onViewRequirements,
}: RegisterImageModalProps) {
  const canSave = result !== undefined && result.status !== 'invalid';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="注册新镜像"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="flex w-full max-w-xl flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <h3 className="text-base font-semibold">📦 注册新镜像</h3>

        <label className="flex flex-col gap-1 text-sm">
          <span>镜像 URI</span>
          <input
            type="text"
            name="image-uri"
            // 打开后焦点自动入 URI 输入框（P21-4 §6）。view 被禁用 useEffect，所以只能走 autoFocus——
            // 这也正是它该在 view 里的理由：它是渲染的一部分，不是副作用。
            autoFocus
            placeholder="docker.io/myrepo/ml-agent:v1.0"
            className="rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={uri}
            disabled={validating || saving}
            onChange={(e) => {
              onUriChange(e.target.value);
            }}
          />
        </label>

        {uriError !== undefined && uriError !== '' && (
          <p role="alert" className="text-xs text-red-400">
            {uriError}
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          ℹ️ 镜像须兼容 OCI 标准；验证会检查可达性及依赖项。填 tag 会在此刻
          <strong className="font-medium">钉定</strong>
          为一个 digest；上游之后重推同一 tag 不会自动生效，需在卡片上 [检查更新]。
        </p>

        {duplicate !== undefined && (
          <div
            className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-xs"
            data-testid="duplicate-hint"
          >
            <span>{duplicate.message}</span>
            {onLocateExisting !== undefined && (
              <Button type="button" variant="outline" size="sm" onClick={onLocateExisting}>
                定位到该镜像
              </Button>
            )}
          </div>
        )}

        {/* 结果区：容器清掉 result 后这里整块消失（不是 hidden）。 */}
        {result !== undefined && (
          <ValidationResultView
            {...result}
            {...(onViewRequirements === undefined ? {} : { onViewRequirements })}
          />
        )}

        {result === undefined && conclusionInvalidated && (
          <p className="text-xs text-muted-foreground" data-testid="conclusion-invalidated">
            已修改镜像地址，请重新验证
          </p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={validating || saving}
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={validating || saving || uri.trim() === ''}
            onClick={onValidate}
          >
            {validating ? '验证中…' : '验证'}
          </Button>
          {/* ✅/⚠️ 才出现 [保存]；❌ 与"无结论"一样，**根本不渲染**。 */}
          {canSave && (
            <Button type="button" size="sm" disabled={saving} onClick={onSave}>
              {saving ? '保存中…' : '保存'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
