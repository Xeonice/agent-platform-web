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
import type { Ref } from 'react';
import Link from 'next/link';
import { AlertTriangle, Info, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ValidationResultView } from '@/views/image/ValidationResult.view';
import type { ImageValidationResultData, ImageRequestFailureModel } from '@/types/image';

export interface RegisterImageModalProps {
  validateRef?: Ref<HTMLButtonElement>;
  saveRef?: Ref<HTMLButtonElement>;
  uri: string;
  alias?: string;
  aliasCount?: number;
  aliasError?: string;
  aliasInvalid?: boolean;
  onAliasChange?: (next: string) => void;
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
  requestFailure?: ImageRequestFailureModel;
  onRetry?: () => void;
  requirementsOpen?: boolean;
  onLocateExisting?: () => void;
  onViewRequirements?: () => void;
}

export function RegisterImageModalView({
  uri,
  alias = '',
  aliasCount = 0,
  aliasError,
  aliasInvalid = false,
  onAliasChange,
  validateRef,
  saveRef,
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
  requestFailure,
  onRetry,
  requirementsOpen = false,
  onLocateExisting,
  onViewRequirements,
}: RegisterImageModalProps) {
  const canSave = result !== undefined && result.status !== 'invalid';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="注册新镜像"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !validating && !saving) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="flex max-h-[90dvh] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-background p-5">
        <h3 className="flex items-center gap-1.5 text-base font-semibold">
          <Package aria-hidden="true" className="h-4 w-4" />
          注册新镜像
        </h3>

        <label className="flex flex-col gap-1 text-sm">
          <span>镜像 URI</span>
          <input
            type="text"
            name="image-uri"
            aria-invalid={uriError !== undefined}
            aria-describedby={uriError === undefined ? undefined : 'image-uri-error'}
            // 打开后焦点自动入 URI 输入框（P21-4 §6）。view 被禁用 useEffect，所以只能走 autoFocus——
            // 这也正是它该在 view 里的理由：它是渲染的一部分，不是副作用。
            autoFocus
            placeholder="docker.io/myrepo/ml-agent:v1.0"
            className="rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={uri}
            readOnly={validating || saving}
            onChange={(e) => {
              onUriChange(e.target.value);
            }}
          />
        </label>

        {uriError !== undefined && uriError !== '' && (
          <p id="image-uri-error" role="alert" className="text-xs text-red-400">
            {uriError}
          </p>
        )}

        {onAliasChange === undefined ? null : (
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="register-image-alias">别名（可选）</label>
              <span className="text-xs text-muted-foreground">{aliasCount}/64</span>
            </div>
            <input
              id="register-image-alias"
              type="text"
              value={alias}
              readOnly={validating || saving}
              aria-invalid={aliasError !== undefined}
              aria-describedby={`register-image-alias-help${aliasError === undefined ? '' : ' register-image-alias-error'}`}
              className="min-w-0 rounded-md border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              onChange={(event) => {
                onAliasChange(event.target.value);
              }}
              onPaste={(event) => {
                event.preventDefault();
                const input = event.currentTarget;
                onAliasChange(
                  alias.slice(0, input.selectionStart ?? alias.length) +
                    event.clipboardData.getData('text') +
                    alias.slice(input.selectionEnd ?? alias.length),
                );
              }}
            />
            <p id="register-image-alias-help" className="text-xs text-muted-foreground">
              用于识别镜像，不修改镜像地址。已有镜像的别名请在卡片上编辑。
            </p>
            {aliasError === undefined ? null : (
              <p id="register-image-alias-error" role="alert" className="text-xs text-destructive">
                {aliasError}
              </p>
            )}
          </div>
        )}

        {/*
          ⚠️ **硬约束前置，不能等验证失败才说**（2026-09 修）。此前这里只写「须兼容 OCI 标准；
          验证会检查可达性及依赖项」—— 真正会拒绝用户的那一条（`IMAGE_BASE_REQUIRED`：镜像
          必须从平台预制镜像改起）**一个字都没有**，于是每个新用户都必然先失败一次。
          ⚠️ 「按镜像内容比对」这半句同样不能省：不说的话，被拒之后最自然的动作是去改标签。
        */}
        <p
          data-testid="register-lineage-constraint"
          className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground"
        >
          <AlertTriangle
            aria-hidden="true"
            data-testid="register-lineage-constraint-icon"
            className="mr-1 inline h-3 w-3 shrink-0 align-text-bottom"
          />
          <strong className="font-medium text-foreground">
            自定义镜像必须从平台的预制镜像改起
          </strong>
          （Dockerfile 第一行 FROM
          平台预制镜像，或它的派生）。平台按镜像内容比对来源，改标签、改名都不算数。
          {onViewRequirements !== undefined && (
            <>
              {' '}
              <button
                type="button"
                className="underline underline-offset-2"
                aria-expanded={requirementsOpen}
                onClick={onViewRequirements}
              >
                查看镜像要求
              </button>
            </>
          )}
        </p>

        <p className="text-xs text-muted-foreground">
          <Info aria-hidden="true" className="mr-1 inline h-3 w-3 shrink-0 align-text-bottom" />
          镜像须兼容 OCI 标准；验证会检查连得上、以及上面那几条。填 tag 会在此刻
          <strong className="font-medium">锁定</strong>
          成一个具体版本；镜像下载源之后重推同一个 tag 不会自动生效，需在卡片上 [检查更新]。
        </p>

        {duplicate !== undefined && (
          <div
            className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-xs"
            role="status"
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
            requirementsOpen={requirementsOpen}
            {...(onViewRequirements === undefined ? {} : { onViewRequirements })}
          />
        )}

        {result === undefined && conclusionInvalidated && (
          <p className="text-xs text-muted-foreground" data-testid="conclusion-invalidated">
            已修改镜像地址，请重新验证
          </p>
        )}

        {requestFailure === undefined ? null : (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{requestFailure.message}</p>
            {requestFailure.retryable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRetry}
                disabled={validating || saving}
              >
                重试
              </Button>
            ) : null}
            {requestFailure.systemLink ? (
              <Link href="/settings/system" className="underline">
                查看系统状态
              </Link>
            ) : null}
          </div>
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
            ref={validateRef}
            onClick={onValidate}
          >
            {validating ? '验证中…' : '验证'}
          </Button>
          {/* ✅/⚠️ 才出现 [保存]；❌ 与"无结论"一样，**根本不渲染**。 */}
          {canSave && (
            <Button
              ref={saveRef}
              type="button"
              size="sm"
              disabled={saving || aliasInvalid}
              onClick={onSave}
            >
              {saving ? '保存中…' : '保存'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
