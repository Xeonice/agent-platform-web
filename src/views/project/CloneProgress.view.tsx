// 克隆进度 UI（10 §7.4 project.clone_progress）：cloning 进度条 / slow 提示 / done 完成 / failed 分支引导。
// 纯展示、props 驱动、零副作用。所有决策（percent/引导/可重试）由 hook+lib 派生后传入。
import { Button } from '@/components/ui/button';
import type { CloneProgressPhase } from '@/types/project';

export interface CloneProgressProps {
  projectName: string;
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
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-5 p-6 text-center">
      <div>
        <h2 className="text-lg font-semibold">
          {phase === 'done' ? '项目已就绪' : phase === 'failed' ? '克隆失败' : '正在克隆项目…'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{projectName}</p>
      </div>

      {(phase === 'cloning' || phase === 'slow') && (
        <div className="w-full" role="status" aria-live="polite">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={
                'h-full rounded-full bg-primary transition-[width] duration-500 ease-out ' +
                (percent === null ? 'w-1/3 animate-pulse' : '')
              }
              style={percent === null ? undefined : { width: `${String(percent)}%` }}
            />
          </div>
          {/* 百分比挪到条子右上角：与条子同一视线，不再挤占明细行。
              percent 为 null（空窗期/git 还没给数）时不出这一格，条子走脉冲态。 */}
          {percent !== null && (
            <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">{percent}%</p>
          )}
          {(detailLabel !== undefined && detailLabel !== '') ||
          (elapsedLabel !== undefined && elapsedLabel !== '') ? (
            <div className="mt-2 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
              <span className="truncate">{detailLabel}</span>
              {/* 已用时长右对齐且 tabular-nums：秒位跳动时整行不左右抖。 */}
              <span className="shrink-0 tabular-nums">{elapsedLabel}</span>
            </div>
          ) : null}
          {phase === 'slow' && (
            <p className="mt-2 text-xs text-yellow-300">
              仍在克隆，仓库较大或网络较慢，请继续等待…
            </p>
          )}
          {onCancel !== undefined && (
            <div className="mt-4">
              <Button type="button" variant="ghost" onClick={onCancel}>
                返回（后台继续克隆）
              </Button>
            </div>
          )}
        </div>
      )}

      {phase === 'done' && (
        <Button onClick={onDone} disabled={busy}>
          打开项目
        </Button>
      )}

      {phase === 'failed' && (
        <div className="flex w-full flex-col items-center gap-3">
          <p role="alert" className="text-sm text-red-400">
            {guidanceMessage ?? '克隆失败，请重试。'}
          </p>
          {actionError !== undefined && actionError !== '' && (
            <p role="alert" className="text-xs text-red-400">
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
            <Button variant="ghost" disabled={busy} onClick={onConvertToEmpty}>
              转为空项目
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
