// 草稿校验 + payload 构造（F21-7 §7.1 `useAutomations` ⑤⑥ / §9.1 #32）。
import { describe, it, expect } from 'vitest';
import {
  buildCreatePayload,
  buildUpdatePayload,
  draftHasErrors,
  promptLength,
  validateDraft,
  type AutomationDraft,
} from '@/lib/automation/automationPayload';
import { TASK_PROMPT_MAX_LENGTH } from '@/types/task';

function draft(overrides: Partial<AutomationDraft> = {}): AutomationDraft {
  return {
    name: '每天凌晨数据分析',
    description: '',
    runtime: 'codex',
    prompt: '汇总昨天的日志',
    scheduleKind: 'daily',
    scheduleConfig: { time: '08:00' },
    timezone: 'Asia/Shanghai',
    timezoneTouched: false,
    timeoutMinutes: 120,
    artifactRetentionDays: 7,
    webhookEnabled: false,
    webhookUrl: '',
    triggerOn: 'failure',
    ...overrides,
  };
}

describe('validateDraft', () => {
  it('完整草稿无错', () => {
    expect(draftHasErrors(validateDraft(draft()))).toBe(false);
  });

  it('名称必填', () => {
    expect(validateDraft(draft({ name: '   ' })).name).toBeDefined();
  });

  it('⭐ prompt 上限与向导「任务指令」同一常量（不另抄一份 8000）', () => {
    const over = 'a'.repeat(TASK_PROMPT_MAX_LENGTH + 1);
    expect(validateDraft(draft({ prompt: over })).prompt).toBeDefined();
    expect(
      validateDraft(draft({ prompt: 'a'.repeat(TASK_PROMPT_MAX_LENGTH) })).prompt,
    ).toBeUndefined();
    expect(validateDraft(draft({ prompt: '' })).prompt).toBeDefined();
  });

  it('⭐ 计数按码点，emoji 不算两个（与 HeadlessTaskLauncher 同一算法）', () => {
    expect(promptLength('🙂')).toBe(1);
    expect('🙂'.length).toBe(2); // 反证：用 .length 会多数一个
  });

  it('调度非法 → schedule 错', () => {
    expect(validateDraft(draft({ scheduleConfig: {} })).schedule).toBeDefined();
  });

  it('webhook 启用但 URL 空 → webhookUrl 错', () => {
    expect(validateDraft(draft({ webhookEnabled: true, webhookUrl: '' })).webhookUrl).toBeDefined();
  });
});

describe('buildCreatePayload', () => {
  it('⭐ 创建 payload **必带 timezone**（这一刻就是快照，23 I-AUT-9）', () => {
    const payload = buildCreatePayload(draft());
    expect(Object.keys(payload)).toContain('timezone');
    expect(payload.timezone).toBe('Asia/Shanghai');
  });

  it('未启用 webhook → 两个键都不发（空串在后端是"配了个非法 URL"）', () => {
    const payload = buildCreatePayload(draft({ webhookEnabled: false, webhookUrl: 'https://x/y' }));
    expect('webhookUrl' in payload).toBe(false);
    expect('triggerOn' in payload).toBe(false);
  });

  it('启用 webhook → 两个键一起发', () => {
    const payload = buildCreatePayload(
      draft({ webhookEnabled: true, webhookUrl: ' https://x/y ', triggerOn: 'all' }),
    );
    expect(payload.webhookUrl).toBe('https://x/y');
    expect(payload.triggerOn).toBe('all');
  });

  it('空描述不发（后端会把空串存成一个空描述，而不是"没有描述"）', () => {
    expect('description' in buildCreatePayload(draft({ description: '  ' }))).toBe(false);
    expect(buildCreatePayload(draft({ description: '每日报表' })).description).toBe('每日报表');
  });
});

describe('⭐⭐ buildUpdatePayload · 编辑时不得隐式重传 timezone（#32）', () => {
  it('用户没改过时区 → payload 的**键集合**里没有 timezone', () => {
    const payload = buildUpdatePayload(draft({ timezoneTouched: false }));
    // ★ 断言的是键集合，不是值 —— 断言值相等的话，"传了一个恰好相同的时区"会被放过，
    //   而那正是这个 bug 的形态：在同一台机器上测，值永远相同，看不出任何问题。
    expect(Object.keys(payload)).not.toContain('timezone');
    expect('timezone' in payload).toBe(false);
    expect(JSON.parse(JSON.stringify(payload))).not.toHaveProperty('timezone');
  });

  it('⭐ 即便草稿里的 timezone 与规则不同（用户换了台机器打开），没显式改过就不传', () => {
    // 这就是那个 bug 的现场：草稿的时区来自规则快照，但假如有人把它初始化成浏览器时区，
    // 只要 timezoneTouched 是 false，这里就必须仍然不传。
    const payload = buildUpdatePayload(
      draft({ timezone: 'America/New_York', timezoneTouched: false }),
    );
    expect('timezone' in payload).toBe(false);
  });

  it('用户显式改过 → 这一次才带上', () => {
    const payload = buildUpdatePayload(
      draft({ timezone: 'America/New_York', timezoneTouched: true }),
    );
    expect(payload.timezone).toBe('America/New_York');
  });

  it('除 timezone 外，创建与编辑的键集合一致（不会顺手漏字段）', () => {
    const create = Object.keys(buildCreatePayload(draft()))
      .filter((k) => k !== 'timezone')
      .sort();
    const update = Object.keys(buildUpdatePayload(draft())).sort();
    expect(update).toEqual(create);
  });
});
