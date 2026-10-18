// 初始化的显式快照确认。ACK wire 保持不变，确认不代表禁用任务入口。
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface OfflineNoticeProps {
  /**
   * 探测结论（`ConnectivityCheckModel.verdictText`，verdict 为 `offline` 时）。
   * ⛔ 不要在本文件里造一句"更贴合本页"的替代文案 —— 见文件头。
   */
  verdictText: string;
  /** 已经点过 [继续]：改显示已确认态（⛔ 不消失——用户要能看见自己确认了什么）。 */
  acknowledged: boolean;
  onContinue: () => void;
}

export function OfflineNoticeView({ acknowledged, onContinue }: OfflineNoticeProps) {
  return (
    <section
      data-testid="offline-notice"
      data-acknowledged={acknowledged ? 'true' : 'false'}
      role="alert"
      className="flex flex-col gap-2 rounded-md border border-red-500/50 bg-red-500/5 p-3 text-sm"
    >
      <p className="flex items-center gap-1.5 font-medium text-red-500">
        <X aria-hidden="true" className="h-4 w-4 shrink-0" />
        确认联网检查结果
      </p>
      {/* 只确认上方已展示的目标快照，不重复推断任务能力。 */}
      <p className="text-muted-foreground">
        这些结果只覆盖上列探测目标；任务实际连通性以其配置和执行结果为准。需要新的记录时，可回系统状态页重新检测。
      </p>
      {acknowledged ? (
        <p
          data-testid="offline-acknowledged"
          className="flex items-start gap-1.5 text-xs text-muted-foreground"
        >
          <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 translate-y-0.5" />
          <span>已确认本次联网检查结果。确认不会禁用任务入口，仍可继续初始化。</span>
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onContinue}>
            我知道，继续
          </Button>
          <span className="text-xs text-muted-foreground">
            确认已了解这些探测结果并继续初始化，不代表所有 Agent 不可用。
          </span>
        </div>
      )}
    </section>
  );
}
