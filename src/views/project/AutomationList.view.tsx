// 规则列表（F21-7 §3 主视图）。纯展示、props 驱动。
import { Button } from '@/components/ui/button';
import { AutomationEmptyStateView } from '@/views/project/AutomationEmptyState.view';
import { AutomationListItemView } from '@/views/project/AutomationListItem.view';
import { AUTOMATION_RULE_LIMIT, type AutomationRow } from '@/types/automation';

export interface AutomationListProps {
  rows: AutomationRow[];
  loading: boolean;
  /** 列表取不回来（≠ 取回来是空的，两者各有分支）。 */
  loadErrorMessage?: string;
  actionErrorMessage?: string;
  selectedId?: string | null;
  togglingId?: string | null;
  /** 规则数已达 20（P21-7 §3.2）→ [+ 新建规则] 置灰 + 上限提示。 */
  atLimit: boolean;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onToggle: (id: string, next: boolean) => void;
  onShowFailure: (id: string) => void;
}

export function AutomationListView({
  rows,
  loading,
  loadErrorMessage,
  actionErrorMessage,
  selectedId = null,
  togglingId = null,
  atLimit,
  onCreate,
  onSelect,
  onToggle,
  onShowFailure,
}: AutomationListProps) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 text-sm" data-testid="automation-list">
      {loading && (
        <p className="text-xs text-muted-foreground" data-testid="automation-loading">
          正在读取自动化规则…
        </p>
      )}

      {/* ⚠️ 「取不回来」与「取回来是空的」必须是两个分支：一次 500 被空态盖住，
          用户会以为自己从来没建过规则（useAuditStream ⑥ 同一条教训）。 */}
      {loadErrorMessage !== undefined && loadErrorMessage !== '' && (
        <p role="alert" className="text-xs text-red-400" data-testid="automation-load-error">
          {loadErrorMessage}
        </p>
      )}

      {actionErrorMessage !== undefined && actionErrorMessage !== '' && (
        <p role="alert" className="text-xs text-red-400" data-testid="automation-action-error">
          {actionErrorMessage}
        </p>
      )}

      {!loading && loadErrorMessage === undefined && rows.length === 0 && (
        <AutomationEmptyStateView onCreate={onCreate} />
      )}

      {rows.length > 0 && (
        <>
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <AutomationListItemView
                key={row.id}
                row={row}
                selected={row.id === selectedId}
                busy={row.id === togglingId}
                onSelect={onSelect}
                onToggle={onToggle}
                onShowFailure={onShowFailure}
              />
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <Button size="sm" disabled={atLimit} onClick={onCreate} data-testid="automation-create">
              + 新建规则
            </Button>
            {atLimit && (
              <span className="text-xs text-amber-500" data-testid="automation-limit-note">
                每个项目最多 {AUTOMATION_RULE_LIMIT} 条规则，先删一条再建。
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
