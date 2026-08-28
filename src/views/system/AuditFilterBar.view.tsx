// 审计流筛选条（F21-5 §3 / P21-5 §10.2）：类别下拉 · [仅告警] 开关 · 时间范围。
//
// ⚠️ **三个都是筛选，没有一个是翻页**（§3A ⑤）。时间范围尤其容易被当成"翻到那一天"——
// 它走 `from`/`to`，与 `seq` 游标是两套坐标；折算成 seq 会在边界上悄悄吞记录。
//
// ⚠️ 本组件**不持有 state、不换算时间**：`datetime-local` 的值原样透出，ISO 换算在容器里
// （view 碰不到 lib，也不该碰 `Date`）。切换筛选后游标由 query key 天然重置，
// 这里**没有**任何 reset 回调——有的话就说明有人在手动清游标（§3A ④ 明令不写）。
// （⚠️ 「天然重置」只管游标：hook 里跟着筛选才有意义的 state 由 `useAuditStream` 自己
// 绑定到 query key 上清空，那件事同样不该冒到这一层来。）
//
// ⚠️ [仅告警] 是一个**服务端**筛选（wire 上是 `severity=warn,error`，10 §6.6.1 的多值），
// 不是"把已加载的行藏起来"。这一点在 UI 上完全看不出来，却决定了空态说的是
// 「全表没有告警」还是「最近 200 条里没有告警」——后者会让用户读出"平台从没告警过"。
import type { AuditCategory } from '@/types/audit';

const CATEGORY_OPTIONS: { value: AuditCategory; label: string }[] = [
  { value: 'sandbox', label: '沙箱' },
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

      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={alertsOnly}
          onChange={(e) => {
            onAlertsOnlyChange(e.target.checked);
          }}
        />
        <span>仅告警</span>
      </label>

      <label className="flex items-center gap-1">
        <span className="text-muted-foreground">起</span>
        <input
          type="datetime-local"
          aria-label="起始时间"
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
          className="rounded-md border border-border bg-transparent px-2 py-1 text-xs"
          value={toLocal}
          onChange={(e) => {
            onToChange(e.target.value);
          }}
        />
      </label>
    </div>
  );
}
