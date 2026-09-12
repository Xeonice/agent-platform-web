// 全局横幅栈（07 §8.4 / F21-8 §4 / design-notes.md §4 Phase 3 第 3 条）。纯展示、props 驱动、
// 零副作用。
//
// ⚠️ **本 view 不做任何优先级判断、不认识"离线"/"治理"这些具体事实**：它收到的数组已经
// 排好序、已经剔除了被关闭的那几条（07 §8.4「BannerStack.view 只接收已排好序的数组」）。
// 判定住在 `lib/system/globalBanner.ts`，那里可以被纯函数测到；写进这里就只能靠渲染测。
// 本层只做**按 severity 分层的三色视觉**（原型 `.banner-blocking`/`.banner-governance`/
// `.banner-info` 三条 CSS 规则的落地），⛔ `info` 那一档目前没有生产方（`types/banner.ts`
// 文件头），`SEVERITY_*` 表因此只有 `blocking`/`warning` 两个键——加一个没人产出的键，
// 只会造成"三色都做好了"的错觉。
//
// ⚠️ **一条都没有时返回 `null`，⛔ 不返回一个空的容器 `<div>`。** 全局布局把它放在
// `{children}` 之上，一个高度为 0 但仍然存在的盒子会在 flex 列里留下 gap/border 的痕迹 ——
// 表现是"每一页顶上多了一条一像素的线"，而没人会想到去横幅这里找。
//
// ⚠️ 图标不是唯一线索（a11y）：每条同时带一个文字等级前缀，且整块是 `role="alert"`。
import type { BannerSeverity, BannerStackModel, GlobalBannerModel } from '@/types/banner';

const SEVERITY_ICON: Readonly<Record<BannerSeverity, string>> = {
  blocking: '🔴',
  warning: '⚠️',
};
const SEVERITY_TEXT: Readonly<Record<BannerSeverity, string>> = {
  blocking: '阻断',
  warning: '治理',
};

/**
 * 三色分层的视觉 token（数值取自 design/prototype.html 的 `.banner-blocking`/
 * `.banner-governance`，语义色沿用已经跑过 WCAG AA 的 `--error`/`--warning`）。
 * ⚠️ **阻断类保留原先的 `red-*` 具名色**（不是改用 `--error` 变量）：这条不在本轮改动
 * 范围内的既有断言（颜色回归截图/story）绑定的就是这几个类名，贸然换成变量在视觉上
 * 等价、但会打红一批断言不了什么问题的既有用例（P21-1 §9 之外的历史legacy 决策，
 * 留给专门的 token 收敛 PR 处理）。
 */
const SEVERITY_STYLES: Readonly<
  Record<BannerSeverity, { wrapper: string; description: string; action: string; dismiss: string }>
> = {
  blocking: {
    wrapper: 'border-b border-red-500/40 bg-red-500/10 text-red-200',
    description: 'text-red-200/80',
    action: 'border-red-400/50 hover:bg-red-500/20',
    dismiss: 'text-red-200/70 hover:bg-red-500/20',
  },
  warning: {
    wrapper: 'border-b border-[hsl(var(--warning)/0.4)] bg-[hsl(var(--warning)/0.12)] text-warning',
    description: 'text-warning/80',
    action: 'border-[hsl(var(--warning)/0.5)] hover:bg-[hsl(var(--warning)/0.18)]',
    dismiss: 'text-warning/70 hover:bg-[hsl(var(--warning)/0.18)]',
  },
};

export interface BannerStackProps {
  model: BannerStackModel;
  /** 动作按钮（`actionLabel` 存在时才渲染）。 */
  onAction?: (id: GlobalBannerModel['id']) => void;
  /**
   * [关闭]。🔴 阻断类**不自动收起**，只有这一条路（07 §8.4）；⚠️ 治理类关闭后当天不再弹
   * （语义分岔在 `useGlobalBanner` 的 `dismiss` 里，本层只负责转发点击）。
   */
  onDismiss?: (id: GlobalBannerModel['id']) => void;
}

export function BannerStackView({ model, onAction, onDismiss }: BannerStackProps) {
  if (model.banners.length === 0) return null;
  return (
    <div data-testid="banner-stack" className="flex shrink-0 flex-col">
      {model.banners.map((banner) => {
        const style = SEVERITY_STYLES[banner.severity];
        return (
          <div
            key={banner.id}
            role="alert"
            data-testid={`banner-${banner.id}`}
            data-severity={banner.severity}
            className={`flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2 text-sm ${style.wrapper}`}
          >
            <span aria-hidden="true">{SEVERITY_ICON[banner.severity]}</span>
            <span className="sr-only">{SEVERITY_TEXT[banner.severity]}</span>
            <span className="font-semibold">{banner.title}</span>
            <span className={`min-w-0 flex-1 text-xs ${style.description}`}>
              {banner.description}
            </span>
            {banner.actionLabel === undefined ? null : (
              <button
                type="button"
                data-testid={`banner-action-${banner.id}`}
                className={`rounded border px-2 py-0.5 text-xs ${style.action}`}
                onClick={() => onAction?.(banner.id)}
              >
                {banner.actionLabel}
              </button>
            )}
            <button
              type="button"
              aria-label={`关闭「${banner.title}」提示`}
              data-testid={`banner-dismiss-${banner.id}`}
              className={`rounded px-2 py-0.5 text-xs ${style.dismiss}`}
              onClick={() => onDismiss?.(banner.id)}
            >
              关闭
            </button>
          </div>
        );
      })}
    </div>
  );
}
