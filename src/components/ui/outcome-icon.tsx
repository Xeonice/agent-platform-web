// 结果类文案标题前的装饰图标（`OutcomeSeverity` → lucide 图标的查表，落在 view 能碰到的
// component 层——与 `status-pill.tsx` 的 `STATUS_PILL_ICONS` 同一手法，只是形态更轻：
// 没有边框/底色/文字槽，用在一句话标题的行首，而不是列表里的徽标位）。
//
// ⚠️ 这是**新增**文件，不改 `status-pill.tsx` 已有的八态查表——两者的值域刻意同名
// （`OutcomeSeverity` 是 `StatusPillStatus` 的子集），但各自独立维护，谁也不依赖谁。
//
// ⚠️ a11y：图标恒 `aria-hidden`——语义信息必须留在文字里（调用方的标题文案本身就说清了
// "发生了什么"，图标只是加一层视觉线索，去掉图标那句话仍然完整）。
import * as React from 'react';
import { AlertTriangle, Check, Clock, Info, X, type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/_shared/utils';
import type { OutcomeSeverity } from '@/types/outcomeSeverity';

const OUTCOME_ICONS: Readonly<Record<OutcomeSeverity, LucideIcon>> = {
  ok: Check,
  info: Info,
  warn: AlertTriangle,
  fail: X,
  timeout: Clock,
};

export interface OutcomeIconProps extends Omit<React.SVGAttributes<SVGSVGElement>, 'children'> {
  severity: OutcomeSeverity;
}

export const OutcomeIcon = React.forwardRef<SVGSVGElement, OutcomeIconProps>(
  ({ severity, className, ...props }, ref) => {
    const Icon = OUTCOME_ICONS[severity];
    return (
      <Icon
        ref={ref}
        aria-hidden="true"
        data-outcome-severity={severity}
        className={cn('h-4 w-4 shrink-0', className)}
        {...props}
      />
    );
  },
);
OutcomeIcon.displayName = 'OutcomeIcon';
