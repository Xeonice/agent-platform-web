// 克隆进度 UI（10 §7.4 project.clone_progress）：cloning 进度条 / slow 提示 / done 完成 / failed 分支引导。
// 纯展示、props 驱动、零副作用。所有决策（percent/引导/可重试）由 hook+lib 派生后传入。
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { CircleAlert, CircleCheck, Loader2, TriangleAlert } from 'lucide-react';
import type { CloneProgressPhase } from '@/types/project';

export interface CloneProgressProps {
  projectName: string;
  mainArea?: boolean;
  phase: CloneProgressPhase;
  /** 0–100；null → indeterminate（脉冲条）。 */
  percent: number | null;
  /** 进度明细，如 `接收对象 · 527/26,348 · 380 KB · 189 KB/s`；逐段可缺。 */
  detailLabel?: string;
  /** `已用 1:23`；长克隆里最便宜的"我还活着"信号（done/failed 后不给）。 */
  elapsedLabel?: string;
  /** failed 引导文案。 */
  guidanceMessage?: string;
  /** 重试是否可能有效（PERMISSION 需凭证时 false）。 */
  canRetry?: boolean;
  /** 需要凭证（S3：权限类失败 → 就地引导配置 Git 凭证）。 */
  needsCredentials?: boolean;
  /** 动作进行中（retry/convert 请求）。 */
  busy?: boolean;
  /** retry/convert 失败的可见错误（409/网络等）。 */
  actionError?: string;
  onRetry?: () => void;
  onConvertToEmpty?: () => void;
  /** 权限类失败：就地 [配置 Git 凭证] → 跳凭证页（F21-3 §10.2）。 */
  onConfigureCredentials?: () => void;
  /** 完成后继续（打开项目）。 */
  onDone?: () => void;
  /** cloning/slow 期间的取消/返回路径（避免用户困在该组件里，P0-2）。 */
  onCancel?: () => void;
}

export function CloneProgressView({
  projectName,
  mainArea = false,
  phase,
  percent,
  detailLabel,
  elapsedLabel,
  guidanceMessage,
  canRetry = true,
  needsCredentials = false,
  busy = false,
  actionError,
  onRetry,
  onConvertToEmpty,
  onDone,
  onCancel,
  onConfigureCredentials,
}: CloneProgressProps) {
  const noteId = useId();
  const running = phase === 'cloning' || phase === 'slow';
  const OutcomeIcon = phase === 'failed' ? CircleAlert : phase === 'done' ? CircleCheck : Loader2;
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto px-6 pb-6 pt-4">
      <div
        className={`mx-auto flex w-full flex-col items-center text-center ${mainArea ? 'max-w-lg py-12' : 'pb-1 pt-2'}`}
      >
        <div
          className={`mb-3 grid size-12 shrink-0 place-items-center rounded-lg bg-[var(--v2-surface)] shadow-[shadow:var(--v2-shadow-ring)] ${phase === 'failed' ? 'text-[var(--v2-status-fail-fg)]' : phase === 'done' ? 'text-[var(--v2-status-ok-fg)]' : 'text-muted-foreground'}`}
        >
          <OutcomeIcon
            aria-hidden="true"
            className={`size-6 ${running ? 'animate-spin motion-reduce:animate-none' : ''}`}
          />
        </div>
        <div role={phase === 'failed' ? 'alert' : phase === 'done' ? 'status' : undefined}>
          <h2
            className={`text-base font-semibold leading-6 tracking-[-0.02em] ${phase === 'failed' ? 'text-[var(--v2-status-fail-fg)]' : ''}`}
          >
            {phase === 'done' ? '项目可用了' : phase === 'failed' ? '克隆失败' : '正在克隆项目…'}
          </h2>
          <p className="mt-1 break-all text-sm text-muted-foreground">{projectName}</p>
          {phase === 'failed' && (
            <p className="mt-2 max-w-[440px] text-balance text-sm leading-[22px] text-muted-foreground">
              {guidanceMessage ?? '克隆失败，请重试。'}
            </p>
          )}
          {mainArea && running && (
            <p className="mt-2 text-sm leading-[22px] text-muted-foreground">
              项目正在克隆，克隆完就能发起任务。
            </p>
          )}
        </div>
        {running && (
          <div className="mt-6 w-full max-w-[440px]" role="status" aria-live="polite">
            <div className="flex items-center gap-2.5">
              <div
                role="progressbar"
                aria-label={percent === null ? '克隆进度未知' : '克隆进度'}
                aria-valuemin={0}
                aria-valuemax={100}
                {...(percent === null
                  ? { 'aria-valuetext': '进度未知' }
                  : { 'aria-valuenow': percent })}
                className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--v2-fill-active)]"
              >
                <div
                  className={`h-full rounded-full ${percent === null ? 'clone-progress-indeterminate' : 'bg-foreground transition-[width] duration-500 ease-out'}`}
                  style={percent === null ? undefined : { width: `${String(percent)}%` }}
                />
              </div>
              {percent !== null && (
                <span className="min-w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {percent}%
                </span>
              )}
            </div>
            {(Boolean(detailLabel) || Boolean(elapsedLabel)) && (
              <div className="mt-1.5 flex items-baseline justify-between gap-3 text-left text-xs text-muted-foreground">
                {detailLabel && (
                  <span className="min-w-0 flex-1 truncate" title={detailLabel}>
                    {detailLabel}
                  </span>
                )}
                {elapsedLabel && <span className="shrink-0 tabular-nums">{elapsedLabel}</span>}
              </div>
            )}
            {phase === 'slow' && (
              <p className="mt-2.5 flex items-start gap-1.5 text-left text-[13px] leading-[18px]">
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-[var(--v2-status-warn-fg)]"
                />
                <span>
                  还在克隆。仓库比较大或者网络比较慢，可能要等一会儿——不用一直守在这一屏。
                </span>
              </p>
            )}
          </div>
        )}
        {!mainArea && running && onCancel !== undefined && (
          <Button className="mt-6" variant="ghost" onClick={onCancel}>
            返回（后台继续克隆）
          </Button>
        )}
        {phase === 'done' && (
          <Button className="mt-6" onClick={onDone} disabled={busy}>
            打开项目
          </Button>
        )}
        {phase === 'failed' && (
          <div className="mt-6 flex w-full flex-col items-center gap-3">
            {actionError && (
              <p role="alert" className="text-sm text-[var(--v2-status-fail-fg)]">
                {actionError}
              </p>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              {needsCredentials && onConfigureCredentials !== undefined && (
                <Button variant="outline" disabled={busy} onClick={onConfigureCredentials}>
                  配置 Git 凭证
                </Button>
              )}
              {canRetry && (
                <Button variant="outline" disabled={busy} onClick={onRetry}>
                  重试克隆
                </Button>
              )}
              <Button
                variant="ghost"
                disabled={busy}
                onClick={onConvertToEmpty}
                aria-describedby={noteId}
              >
                改为空项目
              </Button>
            </div>
            <p id={noteId} className="max-w-[360px] text-balance text-xs text-muted-foreground">
              [改为空项目]：项目留着、已有的任务也留着，只是工作区从空的开始，不再关联这个仓库。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
