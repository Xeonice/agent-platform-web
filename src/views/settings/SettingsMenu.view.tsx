// Main navigation follows the workbench sidebar sizing and icon treatment.
import { SquareTerminal, type LucideIcon } from 'lucide-react';

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
      className="flex w-16 shrink-0 flex-col gap-1 border-r border-[var(--v2-border-subtle)] px-3 md:w-[256px]"
    >
      <div className="flex h-16 shrink-0 items-center gap-2 px-1">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
        >
          A
        </span>
        <span className="hidden truncate text-sm font-medium md:inline">Agent 管理平台</span>
      </div>
      <button
        type="button"
        title="任务"
        aria-label="返回工作台"
        onClick={onBackToWorkbench}
        className="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-muted"
      >
        <SquareTerminal aria-hidden="true" className="size-4 shrink-0" />
        <span className="hidden md:inline">任务</span>
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
            title={item.label}
            aria-label={item.label}
            onClick={() => {
              if (!item.disabled) onSelect(item.key);
            }}
            className={
              'flex shrink-0 items-center gap-2 whitespace-nowrap h-9 rounded-md px-2 py-2 text-left text-sm transition-colors ' +
              (active
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent')
            }
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="hidden md:inline">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
