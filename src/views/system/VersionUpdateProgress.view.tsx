import type { UpgradeDisplayModel } from '@/types/upgrade';

export function VersionUpdateProgressView({ model }: { model: UpgradeDisplayModel }) {
  const showOverall =
    model.phase === 'ongoing' || (model.phase === 'ready' && model.percent === 100);
  if (!showOverall && model.stageProgress === undefined) return null;
  const stage = model.stageProgress;
  return (
    <div className="space-y-1.5">
      {showOverall ? (
        <>
          <div
            role="progressbar"
            aria-label="本实例升级进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={model.percent ?? undefined}
            aria-valuetext={
              model.phase === 'ready'
                ? '本实例升级已完成 · 100%'
                : (model.progressText ?? '等待进度确认')
            }
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            {model.percent === null ? null : (
              <div className="h-full bg-primary" style={{ width: `${String(model.percent)}%` }} />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {model.phase === 'ready' ? '本实例升级已完成 · 100%' : model.progressText}
          </p>
          {model.percent === null && model.lastSeenText !== null ? (
            <p className="text-xs text-muted-foreground">{model.lastSeenText}</p>
          ) : null}
        </>
      ) : null}
      {stage === undefined ? null : (
        <div className="space-y-1.5 border-t border-border pt-2">
          <p className="text-xs text-muted-foreground">
            {stage.stale ? '上次确认：' : ''}
            {stage.label}
            {stage.percent === null ? '' : ` · ${String(stage.percent)}%（仅当前阶段）`}
          </p>
          <div
            role="progressbar"
            aria-label={`${stage.stale ? '上次确认的' : ''}${stage.label}进度`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={stage.percent ?? undefined}
            aria-valuetext={stage.workText ?? '当前阶段总量待确认'}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            {stage.percent === null ? null : (
              <div className="h-full bg-primary" style={{ width: `${String(stage.percent)}%` }} />
            )}
          </div>
          {stage.workText === null ? null : (
            <p className="text-xs text-muted-foreground">{stage.workText}</p>
          )}
          {stage.elapsedText === null || stage.stale ? null : (
            <p className="text-xs text-muted-foreground">{stage.elapsedText}</p>
          )}
          {stage.lastProgressText === null ? null : (
            <p className="text-xs text-muted-foreground">{stage.lastProgressText}</p>
          )}
          {stage.stale ? (
            <p className="text-xs text-muted-foreground">状态待确认，已停止实时计时。</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
