import type { UpgradeDisplayModel } from '@/types/upgrade';

export function VersionUpdateProgressView({ model }: { model: UpgradeDisplayModel }) {
  if (model.phase !== 'ongoing' && (model.phase !== 'ready' || model.percent !== 100)) return null;
  return (
    <div className="space-y-1.5">
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
    </div>
  );
}
