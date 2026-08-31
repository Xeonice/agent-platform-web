// 规则表单的草稿状态 + 校验 + payload 构造（F21-7 §4「container 局部 state」/ §5 保存分支）。
//
// ⚠️ **安全红线（15 §3.5）：草稿里的 `prompt` 只活在这个 hook 的 `useState` 里。**
//   它与向导的 `initialPrompt` 是同一条红线 —— ⛔ 不进 Zustand、不进 persist、不进任何
//   storage。`uiSlice` 文件头写过："store 上连一个能装它的位置都不该有"。
//   本 hook 用 `useState`，组件卸载即随之消失；container 只拿到它的值与 setter。
//
// ⚠️ container 碰不到 `lib/`（eslint boundaries：container 只能 import view/hook/type/store/component），
//   而校验与 payload 构造全在 `lib/automation/automationPayload`。本 hook 是那道墙上的门。
import { useCallback, useMemo, useState } from 'react';
import {
  buildCreatePayload,
  buildUpdatePayload,
  draftHasErrors,
  promptLength,
  validateDraft,
  type AutomationDraft,
  type DraftErrors,
} from '@/lib/automation/automationPayload';
import { describeScheduleWithZone } from '@/lib/automation/nextTriggerAt';
import { resolveEnvironmentTimeZone } from '@/lib/automation/timeZone';
import type {
  AutomationDto,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from '@/types/automation';

/** 空草稿。**新建**时时区默认取环境时区（P21-7 §3.2「仅新建规则继承当前用户时区」）。 */
export function emptyDraft(): AutomationDraft {
  return {
    name: '',
    description: '',
    runtime: '',
    prompt: '',
    scheduleKind: 'daily',
    scheduleConfig: { time: '08:00' },
    timezone: resolveEnvironmentTimeZone(),
    // 新建时这一位无意义（创建 payload 恒带 timezone），置 false 只是初值。
    timezoneTouched: false,
    timeoutMinutes: 120,
    artifactRetentionDays: 7,
    webhookEnabled: false,
    webhookUrl: '',
    triggerOn: 'failure',
  };
}

/**
 * 以现有规则回填草稿（[编辑]）。
 * ★ `timezone` 取**规则的快照值**，`timezoneTouched` 置 `false` —— 这两句合起来就是
 *   I-AUT-9 的前端侧防线：用户不动时区，PUT 的 body 里就不会出现这个键。
 */
export function draftFromDto(dto: AutomationDto): AutomationDraft {
  return {
    name: dto.name,
    description: dto.description ?? '',
    runtime: dto.runtime,
    prompt: dto.prompt,
    scheduleKind: dto.scheduleKind,
    scheduleConfig: dto.scheduleConfig,
    timezone: dto.timezone,
    timezoneTouched: false,
    timeoutMinutes: dto.timeoutMinutes,
    // 后端的 `artifactRetentionDays` 在契约里是 number（开放集在生成物里丢了闭包，
    // 与 `TASK_TIMEOUT_OPTIONS` 同一处境）⇒ 收窄到三个档位，落不进档位的回落默认 7 天。
    artifactRetentionDays:
      dto.artifactRetentionDays === 3 || dto.artifactRetentionDays === 30
        ? dto.artifactRetentionDays
        : 7,
    webhookEnabled: dto.webhookUrl !== undefined && dto.webhookUrl !== '',
    webhookUrl: dto.webhookUrl ?? '',
    triggerOn: dto.triggerOn ?? 'failure',
  };
}

export interface UseAutomationFormResult {
  draft: AutomationDraft;
  errors: DraftErrors;
  canSave: boolean;
  promptCount: number;
  /** `每天 08:00（Asia/Shanghai）` —— 时区**永远跟着一起显示**。 */
  schedulePreview: string;
  patch: (patch: Partial<AutomationDraft>) => void;
  /**
   * 时区的**唯一**改法。走这个口子才会把 `timezoneTouched` 置真。
   * ⛔ 不要用 `patch({ timezone })` —— 那样 PUT 会静默带上 timezone，正是 #32 要防的。
   */
  setTimeZone: (timezone: string) => void;
  reset: (next: AutomationDraft) => void;
  createPayload: () => CreateAutomationRequest;
  updatePayload: () => UpdateAutomationRequest;
}

export function useAutomationForm(initial: AutomationDraft): UseAutomationFormResult {
  const [draft, setDraft] = useState<AutomationDraft>(initial);

  const patch = useCallback((next: Partial<AutomationDraft>) => {
    setDraft((prev) => {
      // ⛔ 从 patch 通道进来的 timezone 一律丢弃：改时区只有 setTimeZone 一条路，
      //    否则 `timezoneTouched` 会与实际值脱节，PUT 就又开始隐式重传了。
      const rest: Partial<AutomationDraft> = { ...next };
      delete rest.timezone;
      delete rest.timezoneTouched;
      return { ...prev, ...rest };
    });
  }, []);

  const setTimeZone = useCallback((timezone: string) => {
    setDraft((prev) => ({ ...prev, timezone, timezoneTouched: true }));
  }, []);

  const reset = useCallback((next: AutomationDraft) => {
    setDraft(next);
  }, []);

  const errors = useMemo(() => validateDraft(draft), [draft]);

  return {
    draft,
    errors,
    canSave: !draftHasErrors(errors),
    promptCount: promptLength(draft.prompt),
    schedulePreview: describeScheduleWithZone(
      draft.scheduleKind,
      draft.scheduleConfig,
      draft.timezone,
    ),
    patch,
    setTimeZone,
    reset,
    createPayload: useCallback(() => buildCreatePayload(draft), [draft]),
    updatePayload: useCallback(() => buildUpdatePayload(draft), [draft]),
  };
}

export type { AutomationDraft, DraftErrors };
