// 规则列表空态（P21-7 §4 / F21-7 §6）。纯展示。
import { Button } from '@/components/ui/button';

export interface AutomationEmptyStateProps {
  onCreate: () => void;
  /** 达上限时不可能是空态，所以这里没有 disabled —— 空态与上限互斥。 */
}

export function AutomationEmptyStateView({ onCreate }: AutomationEmptyStateProps) {
  return (
    <div
      className="rounded border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground"
      data-testid="automation-empty"
    >
      <p>为重复性工作创建一条自动化规则。</p>
      <p className="mt-1">规则到点会自动起一个无头任务：不开终端，跑完把结果留在运行历史里。</p>
      <div className="mt-3">
        <Button size="sm" onClick={onCreate} data-testid="automation-create">
          + 新建规则
        </Button>
      </div>
    </div>
  );
}
