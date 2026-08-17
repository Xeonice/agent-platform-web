// 设置左侧菜单（F21-3 §2/§3）：三子页互切（当前项高亮）+ [← 返回工作台]。
// 纯展示、props 驱动、零副作用。未接入的子页 disabled（F21-4/F21-5 后续切片）。
export interface SettingsMenuItem {
  key: string;
  label: string;
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
      className="flex w-56 shrink-0 flex-col gap-1 border-r border-border p-3"
    >
      <button
        type="button"
        onClick={onBackToWorkbench}
        className="mb-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted"
      >
        ← 返回工作台
      </button>
      {items.map((item) => {
        const active = item.key === activeKey;
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
              'rounded-md px-3 py-2 text-left text-sm transition-colors ' +
              (active
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent')
            }
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
