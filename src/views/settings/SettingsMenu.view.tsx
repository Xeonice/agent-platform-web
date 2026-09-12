// 设置左侧菜单（F21-3 §2/§3）：三子页互切（当前项高亮）+ [← 返回工作台]。
// 纯展示、props 驱动、零副作用。未接入的子页 disabled（F21-4/F21-5 后续切片）。
//
// ⚠️ **响应式：390px 下这个壳体此前不可用**——写死的 `w-56`（224px）侧边栏不响应式收起，
// 390px 屏宽下内容区被挤到只剩约 118px。⇒ 窄屏（< `sm` 断点）改成**顶部横向可滚动的
// 菜单条**，与 `SettingsLayoutView` 的 `flex-col sm:flex-row` 配合，`sm:` 起再切回
// 左侧竖排侧边栏——不是简单把 `w-56` 改小，那样治标不治本（文字仍会被压得读不清）。
//
// ⚠️ **emoji 收口（F21-5 收尾）**：菜单项此前把图标拼进 `label: string` 文案里
// （`'🔐 凭证管理'`），既不是真图标（换字体/换平台会丢字形），又让 `label`
// 一身兼两职——可见文案 + 可访问名。⇒ 拆出独立的 `icon: LucideIcon` 字段：
//   · 选 `LucideIcon`（组件引用）而不是 `ReactNode`：与 `StatusPill` 的
//     `icon?: LucideIcon` 同一套约定，调用方给"哪个图标"而不是"一段任意 JSX"——
//     尺寸（`h-4 w-4`）、`aria-hidden`、与文字的间距统一由这里定死，不会有调用方
//     顺手塞进交互元素或裸文字，破坏"图标纯装饰"的可访问性前提。
//   · `label` 现在**只**是可见文案，天然也是按钮的可访问名（`<button>` 没有
//     `aria-label` 时，可访问名取自文本内容；图标 `aria-hidden` 不参与计算）。
import type { LucideIcon } from 'lucide-react';

export interface SettingsMenuItem {
  key: string;
  label: string;
  /** 项前图标（纯装饰，`aria-hidden`）——语义按菜单项定，别塞任意 JSX。 */
  icon: LucideIcon;
  /** 未接入的子页置 true（渲染为不可点，避免 404）。 */
  disabled?: boolean;
}

export interface SettingsMenuProps {
  items: SettingsMenuItem[];
  activeKey: string;
  onSelect: (key: string) => void;
  onBackToWorkbench: () => void;
}

export function SettingsMenuView({
  items,
  activeKey,
  onSelect,
  onBackToWorkbench,
}: SettingsMenuProps) {
  return (
    <nav
      aria-label="设置菜单"
      className="flex w-full shrink-0 flex-row items-center gap-1 overflow-x-auto border-b border-border p-2 sm:w-56 sm:flex-col sm:items-stretch sm:gap-1 sm:overflow-visible sm:border-b-0 sm:border-r sm:p-3"
    >
      <button
        type="button"
        onClick={onBackToWorkbench}
        className="mr-1 shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted sm:mr-0 sm:mb-2"
      >
        ← 返回工作台
      </button>
      {items.map((item) => {
        const active = item.key === activeKey;
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            aria-current={active ? 'page' : undefined}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) onSelect(item.key);
            }}
            className={
              'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors ' +
              (active
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent')
            }
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
