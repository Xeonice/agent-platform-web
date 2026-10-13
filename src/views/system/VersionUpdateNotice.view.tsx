import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VersionUpdateProgressView } from '@/views/system/VersionUpdateProgress.view';
import type { UpgradeDisplayModel } from '@/types/upgrade';

export function VersionUpdateNoticeView({
  model,
  busy,
  onUpgrade,
  onRefresh,
  onDetails,
  onClose,
}: {
  model: UpgradeDisplayModel;
  busy: boolean;
  onUpgrade: () => void;
  onRefresh: () => void;
  onDetails: () => void;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="版本更新提醒"
      data-testid="upgrade-notice"
      className="fixed right-4 top-16 z-40 w-[min(300px,calc(100vw-16px))] rounded-xl border border-border bg-background p-3 shadow-sm sm:right-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{model.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{model.subtitle}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0"
          aria-label="今天不再提醒"
          title="今天不再提醒"
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
      <div className="mt-3">
        <VersionUpdateProgressView model={model} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {model.canUpgrade ? (
          <Button size="sm" disabled={busy} onClick={onUpgrade}>
            {busy ? '正在确认请求…' : '立即升级'}
          </Button>
        ) : null}
        {model.canRefresh ? (
          <Button size="sm" disabled={busy} onClick={onRefresh}>
            刷新页面
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onDetails}>
          查看详情
        </Button>
      </div>
    </aside>
  );
}
