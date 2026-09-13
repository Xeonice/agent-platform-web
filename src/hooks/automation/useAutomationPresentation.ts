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

/** 「什么时候发 webhook 通知」。⚠️ 屏上不出现 `trigger_on` 这个字段名。 */
const TRIGGER_TEXT: Record<string, string> = {
  failure: '只在失败时发（超时也算失败）',
  success: '只在成功时发',
  all: '每次都发',
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
      // 屏上叫 Agent；`runtime` 是内部词（10 §6.5 的字段名），⛔ 不上屏。
      { label: 'Agent', value: dto.runtime },
      { label: '什么时候跑', value: describeSchedule(dto.scheduleKind, dto.scheduleConfig) },
      // ★ 时区单独一行，且注明它是**建规则时定下的**——用户才知道这个值为什么不跟着
      //   自己的机器变。⛔ 这一行不许折叠、不许省略（时区必须说清是哪个时区）。
      { label: '时区', value: `${dto.timezone}（建规则时定下的，改别的字段不会动它）` },
      { label: '最长运行时间', value: timeout },
      {
        label: '成果保留期',
        // ⭐ 明说落到哪里：与项目菜单里那个面板是同一条路（13 §2.2.2），不是两套存储。
        // ⚠️ 按钮名与 `ProjectMenuPanel.view` 逐字一致，⛔ 改一处必须一起改。
        value: `${String(dto.artifactRetentionDays)} 天（存放在项目的「保留下来的成果」里）`,
      },
      { label: '撞上了怎么办', value: '跳过（上一次还在跑，这一次就不再起一个）' },
      {
        label: 'Webhook 通知',
        value:
          dto.webhookUrl === undefined || dto.webhookUrl === ''
            ? '没开'
            : `${dto.webhookUrl} · ${TRIGGER_TEXT[dto.triggerOn] ?? '只在失败时发'}`,
      },
      { label: '连着失败', value: `${String(dto.consecutiveFailures)} 次` },
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
