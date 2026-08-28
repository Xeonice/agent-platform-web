// 单条审计行（F21-5 §3 / §6 状态矩阵最后一行）。纯展示、props 驱动、零副作用。
//
// ⚠️ **严重度不能只靠颜色**（a11y，§6）：图标 + 文字 + 颜色**三重线索**同时给。
// 只上色的版本在灰度屏 / 色觉障碍下等于没有严重度这一列，而它看起来完全正常。
//
// ⚠️ **detail 为空的行不给展开箭头**（§5）：判据是 `row.detailText === undefined`——
// model 层对空 detail **不产出**这个字段，正是为了让这里有一个明确的判据，
// 而不是去判 `'{}' `或 `''` 这种"看起来也行"的字符串。
//
// ⚠️ **展开在行内，不弹层**（与 provider [查看日志] 同姿态）：`AuditDetailPanelView`
// 就渲染在这个 `<li>` 里面，story 的 play 断言的就是"父节点是列表行，不是 dialog"。
import { Button } from '@/components/ui/button';
import { AuditDetailPanelView } from '@/views/system/AuditDetailPanel.view';
import type { AuditRowModel, AuditSeverity } from '@/types/audit';

/** 三重线索：图标 / 文字 / 颜色。缺一不可。 */
const SEVERITY_META: Record<AuditSeverity, { icon: string; label: string; className: string }> = {
  info: { icon: 'ℹ️', label: '信息', className: 'text-muted-foreground' },
  warn: { icon: '⚠️', label: '警告', className: 'text-amber-400' },
  error: { icon: '❌', label: '错误', className: 'text-red-400' },
};

const OUTCOME_TEXT: Record<'ok' | 'failed' | 'skipped', string> = {
  ok: '成功',
  failed: '失败',
  skipped: '跳过',
};

export interface AuditEventRowProps {
  row: AuditRowModel;
  expanded?: boolean;
  onToggleDetail: (seq: number) => void;
  onOpenTimeline: (subjectId: string) => void;
}

export function AuditEventRowView({
  row,
  expanded = false,
  onToggleDetail,
  onOpenTimeline,
}: AuditEventRowProps) {
  const severity = SEVERITY_META[row.severity];
  const expandable = row.detailText !== undefined;

  const header = (
    <>
      <span aria-hidden="true" className="w-3 shrink-0 text-center text-muted-foreground">
        {expandable ? (expanded ? '▾' : '▸') : ''}
      </span>
      <time className="shrink-0 font-mono text-[11px] text-muted-foreground">{row.timeText}</time>
      <span className={`flex shrink-0 items-center gap-1 text-[11px] ${severity.className}`}>
        <span aria-hidden="true">{severity.icon}</span>
        <span>{severity.label}</span>
      </span>
      <span className="min-w-0 flex-1 truncate text-left text-xs">{row.summary}</span>
      {row.durationText !== undefined && (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {row.durationText}
        </span>
      )}
      {row.outcome !== undefined && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {OUTCOME_TEXT[row.outcome]}
        </span>
      )}
      {row.errorCode !== undefined && (
        <code className="shrink-0 rounded bg-red-500/10 px-1 text-[11px] text-red-400">
          {row.errorCode}
        </code>
      )}
      <span className="shrink-0 text-[11px] text-muted-foreground">{row.actorText}</span>
    </>
  );

  return (
    <li data-testid={`audit-row-${String(row.seq)}`} className="border-b border-border/40 py-1.5">
      <div className="flex items-center gap-2">
        {expandable ? (
          <button
            type="button"
            aria-expanded={expanded}
            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            onClick={() => {
              onToggleDetail(row.seq);
            }}
          >
            {header}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2 px-1">{header}</div>
        )}
        {row.subjectLink !== undefined && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="shrink-0"
            onClick={() => {
              if (row.subjectLink !== undefined) onOpenTimeline(row.subjectLink.subjectId);
            }}
          >
            {row.subjectLink.label}
          </Button>
        )}
      </div>
      {expanded && row.detailText !== undefined && (
        <AuditDetailPanelView detailText={row.detailText} />
      )}
    </li>
  );
}
