import { Button } from '@/components/ui/button';
import { VersionUpdateProgressView } from '@/views/system/VersionUpdateProgress.view';
import type { UpgradeDisplayModel, UpgradeViewActions } from '@/types/upgrade';

export interface VersionUpdateDetailsProps extends UpgradeViewActions {
  model: UpgradeDisplayModel;
  busy: boolean;
  isChecking: boolean;
  commandMessage: string | null;
  compact?: boolean;
}
export function VersionUpdateDetailsView({
  model,
  busy,
  isChecking,
  commandMessage,
  onCheck,
  onUpgrade,
  onRefresh,
  onLater,
  onDetails,
  onContinue,
  onCopyDiagnostics,
  compact = false,
}: VersionUpdateDetailsProps) {
  return (
    <div className="space-y-3">
      <div>
        <p className="font-medium">{model.title}</p>
        <p className="text-xs text-muted-foreground">{model.subtitle}</p>
      </div>
      <dl className="space-y-1 text-xs">
        {model.facts.map((fact) => (
          <div key={fact.label} className="flex flex-wrap justify-between gap-x-3">
            <dt className="text-muted-foreground">{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {!compact && model.recoverySummary !== undefined ? (
        <section aria-label="失败恢复" className="space-y-1 border-t border-border pt-2 text-xs">
          <p className="font-medium">{model.recoverySummary.stateText}</p>
          {model.recoverySummary.phaseText === null ? null : (
            <p className="text-muted-foreground">
              {model.recoverySummary.stale ? '上次恢复阶段：' : '恢复阶段：'}
              {model.recoverySummary.phaseText}
            </p>
          )}
          {model.recoverySummary.confirmedAt === null ? null : (
            <p className="text-muted-foreground">
              恢复确认时间 {model.recoverySummary.confirmedAt}
            </p>
          )}
          <p className="text-muted-foreground">
            恢复记录时间 {model.recoverySummary.lastObservedAt}
          </p>
        </section>
      ) : null}
      <VersionUpdateProgressView model={model} />
      {model.completionSummary === undefined ? null : (
        <p className="text-xs text-muted-foreground">{model.completionSummary}</p>
      )}
      {model.lastSeenText !== null && model.phase !== 'ongoing' ? (
        <p className="text-xs text-muted-foreground">{model.lastSeenText}</p>
      ) : null}
      {model.progressText !== null && model.phase !== 'ongoing' ? (
        <p className="text-xs text-muted-foreground">{model.progressText}</p>
      ) : null}
      {commandMessage === null ? null : (
        <p role="status" className="text-xs text-muted-foreground">
          {commandMessage}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {model.canUpgrade ? (
          <Button size="sm" onClick={onUpgrade} disabled={busy}>
            {busy ? '正在确认请求…' : (model.upgradeActionLabel ?? '立即升级')}
          </Button>
        ) : null}
        {model.canRefresh ? (
          <Button size="sm" onClick={onRefresh} disabled={busy}>
            刷新页面
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={onCheck} disabled={isChecking}>
          {isChecking
            ? '正在检查…'
            : model.phase === 'failed' || model.phase === 'unknown'
              ? '检查状态'
              : '检查更新'}
        </Button>
        {model.phase === 'failed' &&
        model.canContinueWorking === true &&
        onContinue !== undefined ? (
          <Button size="sm" variant="ghost" onClick={onContinue}>
            继续使用
          </Button>
        ) : null}
        {(model.phase === 'failed' || model.phase === 'unknown' || model.phase === 'recovery') &&
        model.diagnosticText !== undefined &&
        onCopyDiagnostics !== undefined ? (
          <Button size="sm" variant="ghost" onClick={onCopyDiagnostics}>
            复制诊断信息
          </Button>
        ) : null}
        {compact ? (
          <Button size="sm" variant="ghost" onClick={onDetails}>
            查看系统版本详情
          </Button>
        ) : null}
        {model.showEntry ? (
          <Button size="sm" variant="ghost" onClick={onLater}>
            稍后
          </Button>
        ) : null}
      </div>
    </div>
  );
}
