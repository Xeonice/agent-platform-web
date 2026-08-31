// 表单草稿 → 请求体 + 保存前校验（F21-7 §5 交互表 / P21-7 §3.2）。
//
// ★★ **本文件的核心是一条否定性规则：编辑请求体默认不带 `timezone`。**
//    （03 §8.1 / 27 §8 前端纪律 0 / 23 I-AUT-9 / F21-7 §9.1 #32）
//
//    为什么值得单独立一个函数、单独写一条结构性断言：`timezone` 是**创建时快照**的，
//    编辑规则时如果顺手把「当前浏览器时区」再传一遍 —— 而这是最自然的写法，
//    因为草稿对象里本来就有这个字段 —— 用户在另一台机器上改一个 prompt，
//    **凌晨 3 点的任务就被挪到中午 3 点**，界面上没有任何地方提示发生过这件事，
//    日志里也只有一次正常的 PUT。这是这一页最难排查的一类 bug。
//
//    ⇒ `buildUpdatePayload` 只有在 `timezoneTouched === true`（用户在表单里**显式**改过）
//      时才把这个键放进 payload。测试断言的是**键集合**（`'timezone' in payload === false`），
//      不是值 —— 断言值相等的话，"传了一个恰好相同的时区"这种情况会被放过。
import { validateWebhookUrl } from '@/lib/automation/validateWebhookUrl';
import { scheduleToCron } from '@/lib/automation/scheduleToCron';
import { TASK_PROMPT_MAX_LENGTH } from '@/types/task';
import type {
  ArtifactRetentionDays,
  AutomationScheduleConfig,
  CreateAutomationRequest,
  ScheduleKind,
  TriggerOn,
  UpdateAutomationRequest,
} from '@/types/automation';

export interface AutomationDraft {
  name: string;
  description: string;
  runtime: string;
  /** ⚠️ 与向导「任务指令」**同一字段同一上限**（`TASK_PROMPT_MAX_LENGTH`，不另抄一份 8000）。 */
  prompt: string;
  scheduleKind: ScheduleKind;
  scheduleConfig: AutomationScheduleConfig;
  /** 新建时默认 = 环境时区；编辑时 = 规则的快照值。 */
  timezone: string;
  /** ★ 用户是否在表单里**显式**改过时区。编辑分支只认它。 */
  timezoneTouched: boolean;
  timeoutMinutes: number;
  artifactRetentionDays: ArtifactRetentionDays;
  webhookEnabled: boolean;
  webhookUrl: string;
  triggerOn: TriggerOn;
}

export interface DraftErrors {
  name?: string;
  prompt?: string;
  runtime?: string;
  schedule?: string;
  webhookUrl?: string;
}

/** 码点计数，与后端 8000 的口径一致（emoji 不被算成两个）——与 `HeadlessTaskLauncher.view` 同一算法。 */
export function promptLength(prompt: string): number {
  return Array.from(prompt).length;
}

export function validateDraft(draft: AutomationDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (draft.name.trim() === '') errors.name = '请填写规则名称。';

  const len = promptLength(draft.prompt);
  if (len === 0) errors.prompt = '请填写任务内容。';
  else if (len > TASK_PROMPT_MAX_LENGTH) {
    errors.prompt = `任务内容超出 ${String(TASK_PROMPT_MAX_LENGTH)} 字符上限。`;
  }

  if (draft.runtime === '') errors.runtime = '请选择 runtime。';

  const cron = scheduleToCron(draft.scheduleKind, draft.scheduleConfig);
  if (!cron.ok) errors.schedule = cron.reason;

  const webhook = validateWebhookUrl(draft.webhookUrl, draft.webhookEnabled);
  if (!webhook.ok) errors.webhookUrl = webhook.reason;

  return errors;
}

export function draftHasErrors(errors: DraftErrors): boolean {
  return Object.keys(errors).length > 0;
}

function commonFields(draft: AutomationDraft): Omit<CreateAutomationRequest, 'timezone'> {
  const description = draft.description.trim();
  const webhookUrl = draft.webhookUrl.trim();
  return {
    name: draft.name.trim(),
    ...(description === '' ? {} : { description }),
    runtime: draft.runtime,
    prompt: draft.prompt,
    scheduleKind: draft.scheduleKind,
    scheduleConfig: draft.scheduleConfig,
    timeoutMinutes: draft.timeoutMinutes,
    artifactRetentionDays: draft.artifactRetentionDays,
    // webhook 未启用 ⇒ 两个键都不发，而不是发空串：空串在后端是"配了一个非法 URL"。
    ...(draft.webhookEnabled && webhookUrl !== ''
      ? { webhookUrl, triggerOn: draft.triggerOn }
      : {}),
  };
}

/** 创建：**必带 `timezone`** —— 这一刻就是快照发生的时刻（23 I-AUT-9）。 */
export function buildCreatePayload(draft: AutomationDraft): CreateAutomationRequest {
  return { ...commonFields(draft), timezone: draft.timezone };
}

/**
 * 编辑：**默认不带 `timezone`**。只有 `timezoneTouched` 才放进去。
 * 返回值刻意用 `UpdateAutomationRequest`（`timezone` 是 optional），
 * 这样"忘了判断就顺手传"在类型上也不会被默许成必填。
 */
export function buildUpdatePayload(draft: AutomationDraft): UpdateAutomationRequest {
  const base = commonFields(draft);
  if (!draft.timezoneTouched) return base;
  return { ...base, timezone: draft.timezone };
}
