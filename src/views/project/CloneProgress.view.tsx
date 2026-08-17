// 克隆进度 UI（10 §7.4 project.clone_progress）：cloning 进度条 / slow 提示 / done 完成 / failed 分支引导。
// 纯展示、props 驱动、零副作用。所有决策（percent/引导/可重试）由 hook+lib 派生后传入。
import { Button } from '@/components/ui/button';
import type { CloneProgressPhase } from '@/types/project';

export interface CloneProgressProps {
  projectName: string;
  phase: CloneProgressPhase;
  /** 0–100；null → indeterminate（脉冲条）。 */
  percent: number | null;
  /** 进度明细（如 "12.3 MB / 40.0 MB" 或 "45%"），可选。 */
  detailLabel?: string;
  /** failed 引导文案。 */
  guidanceMessage?: string;
  /** 重试是否可能有效（PERMISSION 需凭证时 false）。 */
  canRetry?: boolean;
  /** 需要凭证（S3，暂文案）。 */
  needsCredentials?: boolean;
  /** 动作进行中（retry/convert 请求）。 */
  busy?: boolean;
  /** retry/convert 失败的可见错误（409/网络等）。 */
  actionError?: string;
  onRetry?: () => void;
  onConvertToEmpty?: () => void;
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
  guidanceMessage,
  canRetry = true,
  needsCredentials = false,
  busy = false,
  actionError,
  onRetry,
  onConvertToEmpty,
  onDone,
  onCancel,
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
          {detailLabel !== undefined && detailLabel !== '' && (
            <p className="mt-2 text-xs text-muted-foreground">{detailLabel}</p>
          )}
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
          {needsCredentials && (
            <p className="text-xs text-muted-foreground">凭证管理将在后续版本提供。</p>
          )}
          {actionError !== undefined && actionError !== '' && (
            <p role="alert" className="text-xs text-red-400">
              {actionError}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
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
