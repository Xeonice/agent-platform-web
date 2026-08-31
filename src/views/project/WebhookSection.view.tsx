// Webhook 通知配置（P21-7 §3.2/§7 / 03 §8.5）。纯展示。
//
// ⚠️ 两个数字是**产品与技术已对齐的定值**，不能凭直觉写：
//   投递超时 **10 秒**、失败重试 **2 次**、退避 **5s / 25s**（⛔ 不是常见的 1s→2s→4s）。
//   F21-7 §9.1 #12 专门点了这一条。文案取自 `lib/automation/validateWebhookUrl` 的常量，
//   不在这里另写一份 —— 抄第二份就会漂。
import { Button } from '@/components/ui/button';
import { TRIGGER_ON_OPTIONS, type TriggerOn } from '@/types/automation';

export interface WebhookSectionProps {
  enabled: boolean;
  url: string;
  triggerOn: TriggerOn;
  errorMessage?: string;
  /** 投递纪律说明（由 container 从 lib 常量注入——view 不能 import lib）。 */
  deliveryNote: string;
  testPhase: 'idle' | 'testing' | 'ok' | 'error';
  testErrorMessage?: string;
  onEnabledChange: (enabled: boolean) => void;
  onUrlChange: (url: string) => void;
  onTriggerOnChange: (triggerOn: TriggerOn) => void;
  onTest: () => void;
}

const TRIGGER_LABEL: Record<TriggerOn, string> = {
  failure: '仅失败（含超时）',
  success: '仅成功',
  all: '全部',
};

export function WebhookSectionView({
  enabled,
  url,
  triggerOn,
  errorMessage,
  deliveryNote,
  testPhase,
  testErrorMessage,
  onEnabledChange,
  onUrlChange,
  onTriggerOnChange,
  onTest,
}: WebhookSectionProps) {
  return (
    <fieldset className="flex flex-col gap-2" data-testid="webhook-section">
      <legend className="text-xs font-medium">Webhook 通知</legend>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            onEnabledChange(e.target.checked);
          }}
          data-testid="webhook-enabled"
        />
        启用（定时任务的价值就在「我不在的时候」，仅靠页面横幅收不到）
      </label>

      {enabled && (
        <>
          <input
            type="url"
            value={url}
            placeholder="https://example.com/hooks/automation"
            className="rounded border border-border bg-background px-2 py-1 text-xs"
            onChange={(e) => {
              onUrlChange(e.target.value);
            }}
            data-testid="webhook-url"
          />

          <div className="flex flex-wrap gap-3 text-xs" data-testid="webhook-trigger-on">
            {TRIGGER_ON_OPTIONS.map((option) => (
              <label key={option} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="trigger-on"
                  checked={triggerOn === option}
                  onChange={() => {
                    onTriggerOnChange(option);
                  }}
                  data-testid={`webhook-trigger-${option}`}
                />
                {TRIGGER_LABEL[option]}
              </label>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={testPhase === 'testing'}
              onClick={onTest}
              data-testid="webhook-test"
            >
              {testPhase === 'testing' ? '测试中…' : '测试连接'}
            </Button>
            {testPhase === 'ok' && (
              <span className="text-xs text-emerald-500" data-testid="webhook-test-ok">
                ✅ 已送达一条 event:&quot;test&quot; 样例载荷
              </span>
            )}
            {testPhase === 'error' && (
              <span role="alert" className="text-xs text-red-400" data-testid="webhook-test-error">
                ❌ {testErrorMessage ?? '测试失败'}
              </span>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground" data-testid="webhook-delivery-note">
            {deliveryNote}
          </p>

          {errorMessage !== undefined && errorMessage !== '' && (
            <p role="alert" className="text-xs text-red-400" data-testid="webhook-error">
              {errorMessage}
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
