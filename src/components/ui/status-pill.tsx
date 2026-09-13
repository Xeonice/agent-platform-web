// 八态状态 pill：基于 `badge` 的 cva 思路扩展（design/design-notes.md §2「状态 → 颜色
// 对照表」+ §1 问题 2）。图标 + 文字 + 颜色三重线索——颜色不是唯一的判据。
//
// 八个 variant 的底色/文字色/边框色数值逐字照抄设计稿（design/prototype.html 里的
// `.status-pill[data-status="…"]` 规则），未做任何调整：那些数值逐色跑过 WCAG AA
// 对比度才定案（正文 4.5:1、图形/大字 3:1），改一个透明度或 L 值就可能把某一态的
// 对比度打回不达标。
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  AlertTriangle,
  Check,
  Circle,
  Clock,
  Info,
  Loader2,
  Minus,
  X,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/_shared/utils';

export const STATUS_PILL_STATUSES = [
  'ok',
  'info',
  'warn',
  'fail',
  'timeout',
  'pending',
  'skipped',
  'unknown',
] as const;

export type StatusPillStatus = (typeof STATUS_PILL_STATUSES)[number];

/** 设计稿第 2 节对照表：status → lucide 图标。`fail` 用 `X`（设计稿允许 x / x-circle 二选一）。 */
const STATUS_PILL_ICONS: Record<StatusPillStatus, LucideIcon> = {
  ok: Check,
  info: Info,
  warn: AlertTriangle,
  fail: X,
  timeout: Clock,
  pending: Loader2,
  skipped: Minus,
  unknown: Circle,
};

export const statusPillVariants = cva(
  'inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-sm border px-2 text-xs font-medium leading-none',
  {
    variants: {
      status: {
        ok: 'border-[hsl(var(--success)/0.28)] bg-[hsl(var(--success)/0.12)] text-success',
        info: 'border-[hsl(var(--info)/0.28)] bg-[hsl(var(--info)/0.12)] text-info',
        warn: 'border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.14)] text-warning',
        fail: 'border-[hsl(var(--error)/0.28)] bg-[hsl(var(--error)/0.12)] text-error',
        timeout: 'border-[hsl(var(--timeout)/0.3)] bg-[hsl(var(--timeout)/0.13)] text-timeout',
        // pending：灰底，无边框强调（视觉手法列的原话）——边框用 --border 但不着色。
        pending: 'border-border bg-[hsl(var(--foreground)/0.05)] text-foreground-muted',
        // skipped/unknown：透明底 + 虚线边框，区别于其余六态的实心浅底。
        skipped: 'border-dashed border-[hsl(var(--warning)/0.55)] bg-transparent text-warning',
        unknown:
          'border-dashed border-[hsl(var(--foreground-subtle)/0.65)] bg-transparent text-foreground-subtle',
      } satisfies Record<StatusPillStatus, string>,
    },
    defaultVariants: {
      status: 'unknown',
    },
  },
);

export interface StatusPillProps
  extends
    Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'>,
    VariantProps<typeof statusPillVariants> {
  status: StatusPillStatus;
  /** 状态文字（如「正常」「超时未响应」）；省略时只渲染图标（用于极简 dot 场景之外的紧凑位）。 */
  children?: React.ReactNode;
  /** 覆盖默认图标——正常不需要传，八态已经各自定死一个图标。 */
  icon?: LucideIcon;
  /** 隐藏图标，只留文字 + 颜色（不建议：会退回到问题 2 里"只靠颜色"的老毛病）。 */
  hideIcon?: boolean;
}

export const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ className, status, children, icon, hideIcon = false, ...props }, ref) => {
    const Icon = icon ?? STATUS_PILL_ICONS[status];
    return (
      <span
        ref={ref}
        data-status={status}
        className={cn(statusPillVariants({ status }), className)}
        {...props}
      >
        {!hideIcon && (
          <Icon
            aria-hidden="true"
            className={cn('h-3 w-3', status === 'pending' && 'animate-spin')}
          />
        )}
        {children}
      </span>
    );
  },
);
StatusPill.displayName = 'StatusPill';

// ============================================================================
// StatusDot —— 极简变体（design-notes.md §4 Phase 3 第 2 条 / 原型 `.dot` 类）。
//
// ⚠️ **新增 variant，不是改现有八态**：这是一个**独立的、更小的组件**，纯色圆点，
// 没有图标、没有文字、没有边框——用在任务树的状态点、组头徽标这类高密度、逐行重复
// 的位置，`StatusPill` 本体（22px 高 + 图标 + 文字）在那里放不下也不需要放下。
// 八个 `data-status="…"` 的颜色/图标/语义（`statusPillVariants` 与 `STATUS_PILL_ICONS`）
// 一个字节都没有改动——这里只是同一套 token 的另一种取用方式（纯背景色，不含边框/文字色）。
//
// ⚠️ 只覆盖原型 `.dot` 类实际给出的六态（ok/warn/fail/timeout/info/unknown）：
// `pending`/`skipped` 原型没有对应的纯 dot 规则（它们的语义分别靠"旋转"和"虚线"表达，
// 缩成一个 7px 纯色点会丢失这两条线索），真需要时再补，⛔ 不是这一轮的题。
export const STATUS_DOT_STATUSES = ['ok', 'warn', 'fail', 'timeout', 'info', 'unknown'] as const;

export type StatusDotStatus = (typeof STATUS_DOT_STATUSES)[number];

/** 逐字对照 design/prototype.html 的 `.dot[data-status="…"]` 规则（六态，纯背景色）。 */
const STATUS_DOT_COLOR: Readonly<Record<StatusDotStatus, string>> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  fail: 'bg-error',
  timeout: 'bg-timeout',
  info: 'bg-info',
  unknown: 'bg-border-strong',
};

export interface StatusDotProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> {
  status: StatusDotStatus;
  /**
   * 无障碍标签。**dot 本身没有可见文字**（这正是"极简"的意思），但色觉之外必须有一条
   * 线索——缺省用状态英文名兜底，调用方知道具体语境时应该传一句人话
   * （如「等待你输入」而不是「warn」）。
   */
  label?: string;
}

export const StatusDot = React.forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ className, status, label, ...props }, ref) => (
    <span
      ref={ref}
      data-status={status}
      data-slot="status-dot"
      role="img"
      aria-label={label ?? status}
      className={cn(
        'inline-block h-[7px] w-[7px] shrink-0 rounded-full',
        STATUS_DOT_COLOR[status],
        className,
      )}
      {...props}
    />
  ),
);
StatusDot.displayName = 'StatusDot';
