// 规则列表的一行（F21-7 §3 / §6 状态矩阵五格）。纯展示、props 驱动、零副作用。
//
// ★ **时区必须出现在这一行上**（P21-7 §3.2 / F21-7 §6）。
//   「下次: 8-10 08:00」单独存在是有歧义的：用户换台机器、或者同事在另一个时区打开，
//   会按自己的钟点读这个时刻，然后以为触发时间漂了。规则的 `timezone` 是**创建时快照**的，
//   界面上把它写出来，"没漂"这件事才是可见的。
import { Button } from '@/components/ui/button';
import type { AutomationRow } from '@/types/automation';

export interface AutomationListItemProps {
  row: AutomationRow;
  selected?: boolean;
  /** 正在启停：只禁这一行的按钮，其余行照常可用。 */
  busy?: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, next: boolean) => void;
  /** 🟡/🔴 时的 [查看原因]（展开最近一次失败的详情）。 */
  onShowFailure: (id: string) => void;
}

export function AutomationListItemView({
  row,
  selected = false,
  busy = false,
  onSelect,
  onToggle,
  onShowFailure,
}: AutomationListItemProps) {
  const enabled = row.lifecycle !== 'off' && row.lifecycle !== 'autoDisabled';
  // 🔴 自动禁用后那个按钮说的是「重新启用」，并且要明示清零（P21-7 §9.1 #25）——
  // 与普通的 [启用] 是同一个端点，但用户面对的是两件不同的事。
  const toggleLabel = row.lifecycle === 'autoDisabled' ? '重新启用' : enabled ? '禁用' : '启用';

  return (
    <li
      className={`rounded border px-3 py-2 ${selected ? 'border-primary bg-muted/40' : 'border-border'}`}
      data-testid="automation-list-item"
      data-lifecycle={row.lifecycle}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => {
            onSelect(row.id);
          }}
          data-testid="automation-select"
        >
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <span aria-hidden="true">{row.icon}</span>
            <span className="truncate">{row.name}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground" data-testid="automation-summary">
            {row.summaryText}
            {row.nextTriggerText !== undefined && ` · 下次: ${row.nextTriggerText}`}
          </p>
          {/* 时区一行永远在，不随状态消失。 */}
          <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid="automation-timezone">
            时区 {row.timezone}
            {row.timezoneNote !== undefined && ` · ${row.timezoneNote}`}
          </p>
          <p
            className={`mt-0.5 text-[11px] ${row.needsAttention ? 'text-amber-500' : 'text-muted-foreground'}`}
            data-testid="automation-status-text"
          >
            {row.statusText}
          </p>
        </button>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              onToggle(row.id, !enabled);
            }}
            data-testid="automation-toggle"
          >
            {toggleLabel}
          </Button>
          {row.needsAttention && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onShowFailure(row.id);
              }}
              data-testid="automation-show-failure"
            >
              查看原因
            </Button>
          )}
        </div>
      </div>

      {row.lifecycle === 'autoDisabled' && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          [重新启用] 会把连续失败计数清零，规则按原调度继续。
        </p>
      )}
    </li>
  );
}
