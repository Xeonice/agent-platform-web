// 全局横幅栈（07 §8.4 / F21-8 §4）。纯展示、props 驱动、零副作用。
//
// ⚠️ **本 view 不做任何优先级判断、不认识"离线"这件事**：它收到的数组已经排好序、已经
// 剔除了被关闭的那几条（07 §8.4「BannerStack.view 只接收已排好序的数组」）。判定住在
// `lib/system/globalBanner.ts`，那里可以被纯函数测到；写进这里就只能靠渲染测。
//
// ⚠️ **一条都没有时返回 `null`，⛔ 不返回一个空的容器 `<div>`。** 全局布局把它放在
// `{children}` 之上，一个高度为 0 但仍然存在的盒子会在 flex 列里留下 gap/border 的痕迹 ——
// 表现是"每一页顶上多了一条一像素的线"，而没人会想到去横幅这里找。
//
// ⚠️ 图标不是唯一线索（a11y）：每条同时带一个文字等级前缀，且整块是 `role="alert"`。
import type { BannerSeverity, BannerStackModel, GlobalBannerModel } from '@/types/banner';

const SEVERITY_ICON: Readonly<Record<BannerSeverity, string>> = { blocking: '🔴' };
const SEVERITY_TEXT: Readonly<Record<BannerSeverity, string>> = { blocking: '阻断' };

export interface BannerStackProps {
  model: BannerStackModel;
  /** 动作按钮（`actionLabel` 存在时才渲染）。 */
  onAction?: (id: GlobalBannerModel['id']) => void;
  /** [关闭]。🔴 阻断类**不自动收起**，只有这一条路（07 §8.4）。 */
  onDismiss?: (id: GlobalBannerModel['id']) => void;
}

export function BannerStackView({ model, onAction, onDismiss }: BannerStackProps) {
  if (model.banners.length === 0) return null;
  return (
    <div data-testid="banner-stack" className="flex shrink-0 flex-col">
      {model.banners.map((banner) => (
        <div
          key={banner.id}
          role="alert"
          data-testid={`banner-${banner.id}`}
          data-severity={banner.severity}
          className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
        >
          <span aria-hidden="true">{SEVERITY_ICON[banner.severity]}</span>
          <span className="sr-only">{SEVERITY_TEXT[banner.severity]}</span>
          <span className="font-semibold">{banner.title}</span>
          <span className="min-w-0 flex-1 text-xs text-red-200/80">{banner.description}</span>
          {banner.actionLabel === undefined ? null : (
            <button
              type="button"
              data-testid={`banner-action-${banner.id}`}
              className="rounded border border-red-400/50 px-2 py-0.5 text-xs hover:bg-red-500/20"
              onClick={() => onAction?.(banner.id)}
            >
              {banner.actionLabel}
            </button>
          )}
          <button
            type="button"
            aria-label={`关闭「${banner.title}」提示`}
            data-testid={`banner-dismiss-${banner.id}`}
            className="rounded px-2 py-0.5 text-xs text-red-200/70 hover:bg-red-500/20"
            onClick={() => onDismiss?.(banner.id)}
          >
            关闭
          </button>
        </div>
      ))}
    </div>
  );
}
