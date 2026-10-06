// 审计筛选是即时服务端过滤，不是翻页：时间范围使用 from/to，与 seq 游标分离。
// view 不持有筛选 state 或转换时间；query key 重置游标，hook 管理相关状态。
// 仅告警使用服务端 severity 筛选和 role=switch，不能只隐藏当前已加载行。
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import type { Ref } from 'react';
import type { AuditCategory } from '@/types/audit';

const CATEGORY_OPTIONS: { value: AuditCategory; label: string }[] = [
  { value: 'sandbox', label: '任务' },
  { value: 'project', label: '项目' },
  { value: 'credential', label: '凭证' },
  { value: 'image', label: '镜像' },
  { value: 'system', label: '系统' },
];

/** 下拉里"全部"那一项的哨兵值（`<option>` 的 value 只能是字符串）。 */
const ALL_CATEGORIES = '';

export interface AuditFilterBarProps {
  category?: AuditCategory;
  alertsOnly: boolean;
  /** `datetime-local` 原样字符串（本地时区）。 */
  fromLocal: string;
  toLocal: string;
  subjectName?: string;
  onClearSubject?: () => void;
  categoryRef?: Ref<HTMLSelectElement>;
  timeError?: string | null;
  timeErrorField?: 'from' | 'to';
  onCategoryChange: (next: AuditCategory | undefined) => void;
  onAlertsOnlyChange: (next: boolean) => void;
  onFromChange: (next: string) => void;
  onToChange: (next: string) => void;
}

function isCategory(value: string): value is AuditCategory {
  return CATEGORY_OPTIONS.some((option) => option.value === value);
}

export function AuditFilterBarView({
  category,
  alertsOnly,
  fromLocal,
  toLocal,
  subjectName,
  onClearSubject,
  categoryRef,
  timeError,
  timeErrorField,
  onCategoryChange,
  onAlertsOnlyChange,
  onFromChange,
  onToChange,
}: AuditFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs" role="group" aria-label="审计流筛选">
      <label className="flex items-center gap-1">
        <span className="text-muted-foreground">类别</span>
        <select
          aria-label="类别"
          ref={categoryRef}
          className="rounded-md border border-border bg-transparent px-2 py-1 text-xs"
          value={category ?? ALL_CATEGORIES}
          onChange={(e) => {
            onCategoryChange(isCategory(e.target.value) ? e.target.value : undefined);
          }}
        >
          <option value={ALL_CATEGORIES}>全部</option>
          {CATEGORY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5">
        <Switch checked={alertsOnly} onCheckedChange={onAlertsOnlyChange} />
        <span>仅告警</span>
      </label>

      <label className="flex items-center gap-1">
        <span className="text-muted-foreground">起</span>
        <input
          type="datetime-local"
          aria-label="起始时间"
          aria-invalid={timeErrorField === 'from' || undefined}
          aria-describedby={timeErrorField === 'from' ? 'audit-time-error' : undefined}
          className="rounded-md border border-border bg-transparent px-2 py-1 text-xs"
          value={fromLocal}
          onChange={(e) => {
            onFromChange(e.target.value);
          }}
        />
      </label>

      <label className="flex items-center gap-1">
        <span className="text-muted-foreground">止</span>
        <input
          type="datetime-local"
          aria-label="结束时间"
          aria-invalid={timeErrorField === 'to' || undefined}
          aria-describedby={timeErrorField === 'to' ? 'audit-time-error' : undefined}
          className="rounded-md border border-border bg-transparent px-2 py-1 text-xs"
          value={toLocal}
          onChange={(e) => {
            onToChange(e.target.value);
          }}
        />
      </label>
      {subjectName === undefined ? null : (
        <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border px-2 py-1">
          <span className="truncate">任务：{subjectName}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0"
            aria-label="清除任务筛选"
            onClick={onClearSubject}
          >
            <X aria-hidden="true" className="h-3 w-3" />
          </Button>
        </span>
      )}
      {timeError == null ? null : (
        <p id="audit-time-error" role="alert" className="w-full text-sm text-destructive">
          {timeError}
        </p>
      )}
    </div>
  );
}
