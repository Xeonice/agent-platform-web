// Ordered banners are supplied by the model; only disclosure state lives in this view.
import { useId, useState } from 'react';
import { AlertTriangle, ChevronDown, OctagonAlert, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BannerSeverity, BannerStackModel, GlobalBannerModel } from '@/types/banner';

const SEVERITY_ICON: Readonly<Record<BannerSeverity, LucideIcon>> = {
  blocking: OctagonAlert,
  warning: AlertTriangle,
};
const SEVERITY_TEXT: Readonly<Record<BannerSeverity, string>> = {
  blocking: '阻断',
  warning: '治理',
};
const SEVERITY_STYLES: Readonly<Record<BannerSeverity, { wrapper: string; foreground: string }>> = {
  blocking: {
    wrapper: 'border-[var(--v2-status-fail-subtle-border)] bg-[var(--v2-status-fail-subtle-bg)]',
    foreground: 'text-[var(--v2-status-fail-fg)]',
  },
  warning: {
    wrapper: 'border-[var(--v2-status-warn-subtle-border)] bg-[var(--v2-status-warn-subtle-bg)]',
    foreground: 'text-[var(--v2-status-warn-fg)]',
  },
};

export interface BannerStackProps {
  model: BannerStackModel;
  onAction?: (id: GlobalBannerModel['id']) => void;
  onDismiss?: (id: GlobalBannerModel['id']) => void;
}

export function BannerStackView({ model, onAction, onDismiss }: BannerStackProps) {
  const [expanded, setExpanded] = useState(false);
  const stackId = useId();
  if (model.banners.length === 0) return null;
  const remaining = model.banners.slice(2);
  const visible = expanded ? model.banners : model.banners.slice(0, 2);
  return (
    <div data-testid="banner-stack" className="flex min-w-0 shrink-0 flex-col">
      <div id={stackId}>
        {visible.map((banner) => {
          const style = SEVERITY_STYLES[banner.severity];
          const Icon = SEVERITY_ICON[banner.severity];
          const governance = banner.severity === 'warning';
          return (
            <div
              key={banner.id}
              role="alert"
              data-testid={`banner-${banner.id}`}
              data-severity={banner.severity}
              className={`flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1 border-b px-4 py-2 text-sm text-foreground sm:flex-nowrap ${style.wrapper}`}
            >
              <Icon aria-hidden="true" className={`mt-2 h-4 w-4 shrink-0 ${style.foreground}`} />
              <span className="sr-only">{SEVERITY_TEXT[banner.severity]}</span>
              <p className="min-w-0 flex-1 basis-[calc(100%_-_24px)] py-1.5 leading-5 sm:basis-auto">
                <span className={`mr-2 font-medium ${style.foreground}`}>{banner.title}</span>
                <span>{banner.description}</span>
              </p>
              <div className="ml-6 flex min-h-8 shrink-0 items-center gap-2 sm:ml-auto">
                {banner.actionLabel === undefined ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={`banner-action-${banner.id}`}
                    className="bg-[var(--v2-surface)] text-foreground"
                    onClick={() => {
                      onAction?.(banner.id);
                    }}
                  >
                    {banner.actionLabel}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size={governance ? 'sm' : 'icon'}
                  aria-label={
                    governance ? `今天不再提示「${banner.title}」` : `关闭「${banner.title}」提示`
                  }
                  data-testid={`banner-dismiss-${banner.id}`}
                  className={governance ? 'text-foreground' : 'h-8 w-8 text-muted-foreground'}
                  onClick={() => {
                    onDismiss?.(banner.id);
                  }}
                >
                  {governance ? '今天不再提示' : <X aria-hidden="true" />}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {remaining.length === 0 ? null : (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={stackId}
          data-testid="banner-stack-more"
          className="flex h-8 min-w-0 items-center gap-2 border-b border-border bg-background px-4 text-left text-[13px] text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:shadow-[var(--v2-focus-ring-inset)]"
          onClick={() => {
            setExpanded((previous) => !previous);
          }}
        >
          <ChevronDown
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 ${expanded ? 'rotate-180' : ''}`}
          />
          <span className="shrink-0">还有 {remaining.length} 条提示</span>
          <span className="truncate text-[var(--v2-foreground-subtle)]">
            {remaining.map((banner) => banner.title).join('、')}
          </span>
        </button>
      )}
    </div>
  );
}
