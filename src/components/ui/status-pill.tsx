// 八态状态 pill：图标、文字、颜色共同表达语义，颜色不是唯一判据。
// 修改语义 token 后需复核正文 4.5:1、图形与大字 3:1 的对比度。
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
  'inline-flex h-5 items-center gap-[5px] whitespace-nowrap rounded-full border border-transparent px-2 text-xs font-medium leading-none',
  {
    variants: {
      status: {
        ok: 'bg-[var(--v2-status-ok-subtle-bg)] text-[var(--v2-status-ok-fg)]',
        info: 'bg-[var(--v2-status-info-subtle-bg)] text-[var(--v2-status-info-fg)]',
        warn: 'bg-[var(--v2-status-warn-subtle-bg)] text-[var(--v2-status-warn-fg)]',
        fail: 'bg-[var(--v2-status-fail-subtle-bg)] text-[var(--v2-status-fail-fg)]',
        timeout: 'bg-[var(--v2-status-timeout-subtle-bg)] text-[var(--v2-status-timeout-fg)]',
        // pending：灰底，无边框强调（视觉手法列的原话）——边框用 --border 但不着色。
        pending: 'bg-[var(--v2-status-neutral-subtle-bg)] text-foreground-muted',
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

// StatusDot 是任务树等高密度场景的独立纯色状态点，共用 StatusPill 的语义 token。
// 这里只提供 ok/warn/fail/timeout/info/unknown；pending/skipped 的旋转或虚线线索不能缩成纯色点。
export const STATUS_DOT_STATUSES = ['ok', 'warn', 'fail', 'timeout', 'info', 'unknown'] as const;

export type StatusDotStatus = (typeof STATUS_DOT_STATUSES)[number];

/** 六态状态点使用纯背景色，不绘制边框或文字。 */
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
