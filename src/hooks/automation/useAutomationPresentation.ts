// 详情视图的配置摘要（F21-7 §3「配置详情」）。
// container 碰不到 `lib/`（boundaries），这个 hook 是那道墙上的门——与 `useRetainedVolumes`
// 承担 DTO → 视图模型转接同一形状。
import { useMemo } from 'react';
import { describeSchedule } from '@/lib/automation/scheduleToCron';
import { WEBHOOK_DELIVERY_NOTE } from '@/lib/automation/validateWebhookUrl';
import type { AutomationDto } from '@/types/automation';

export interface AutomationPresentation {
  configLines: { label: string; value: string }[];
  promptPreview: string;
  webhookDeliveryNote: string;
}

const PROMPT_PREVIEW_CHARS = 300;

const TRIGGER_TEXT: Record<string, string> = {
  failure: '仅失败（含超时）',
  success: '仅成功',
  all: '全部',
};

export function useAutomationPresentation(dto: AutomationDto | undefined): AutomationPresentation {
  return useMemo(() => {
    if (dto === undefined) {
      return { configLines: [], promptPreview: '', webhookDeliveryNote: WEBHOOK_DELIVERY_NOTE };
    }
    const timeout =
      dto.timeoutMinutes < 60
        ? `${String(dto.timeoutMinutes)} 分钟`
        : `${String(dto.timeoutMinutes / 60)} 小时`;
    const lines: { label: string; value: string }[] = [
      { label: 'Runtime', value: dto.runtime },
      { label: '调度', value: describeSchedule(dto.scheduleKind, dto.scheduleConfig) },
      // ★ 时区单独一行，且注明"创建时快照"——用户才知道这个值为什么不跟着自己的机器变。
      { label: '时区', value: `${dto.timezone}（创建时快照，编辑其它字段不会改动它）` },
      { label: '硬超时', value: timeout },
      {
        label: '成果保留期',
        // ⭐ 明说落到「已保留卷」：与刚落地的保留卷面板是同一条路（13 §2.2.2），不是两套存储。
        value: `${String(dto.artifactRetentionDays)} 天（存放在项目的「🎁 已保留卷」里）`,
      },
      { label: '并发模式', value: '跳过（上次还在跑就不再起一个）' },
      {
        label: 'Webhook',
        value:
          dto.webhookUrl === undefined || dto.webhookUrl === ''
            ? '未启用'
            : `${dto.webhookUrl} · ${TRIGGER_TEXT[dto.triggerOn] ?? '仅失败'}`,
      },
      { label: '连续失败', value: `${String(dto.consecutiveFailures)} 次` },
    ];
    const prompt =
      dto.prompt.length > PROMPT_PREVIEW_CHARS
        ? `${dto.prompt.slice(0, PROMPT_PREVIEW_CHARS)}…`
        : dto.prompt;
    return {
      configLines: lines,
      promptPreview: prompt,
      webhookDeliveryNote: WEBHOOK_DELIVERY_NOTE,
    };
  }, [dto]);
}
