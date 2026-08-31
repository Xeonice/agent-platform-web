// 预设 → cron + 人话摘要（F21-7 §7.1）。
import { describe, it, expect } from 'vitest';
import { describeSchedule, scheduleToCron } from '@/lib/automation/scheduleToCron';

describe('scheduleToCron', () => {
  it('每天 08:00', () => {
    expect(scheduleToCron('daily', { time: '08:00' })).toEqual({
      ok: true,
      expression: '0 8 * * *',
    });
  });

  it('每小时 :00 / :30', () => {
    expect(scheduleToCron('hourly', { minute: 0 })).toEqual({ ok: true, expression: '0 * * * *' });
    expect(scheduleToCron('hourly', { minute: 30 })).toEqual({
      ok: true,
      expression: '30 * * * *',
    });
  });

  it('每周一三五 08:00（去重 + 升序，点击顺序不影响结果）', () => {
    expect(scheduleToCron('weekly', { time: '08:00', days: [5, 1, 3, 1] })).toEqual({
      ok: true,
      expression: '0 8 * * 1,3,5',
    });
  });

  it('⭐ 非法输入返回错误而非抛出（调用点是表单的每一次按键）', () => {
    expect(() => scheduleToCron('daily', {})).not.toThrow();
    expect(scheduleToCron('daily', {}).ok).toBe(false);
    expect(scheduleToCron('daily', { time: '99:99' }).ok).toBe(false);
    expect(scheduleToCron('hourly', {}).ok).toBe(false);
    expect(scheduleToCron('hourly', { minute: 60 }).ok).toBe(false);
    expect(scheduleToCron('hourly', { minute: -1 }).ok).toBe(false);
    expect(scheduleToCron('weekly', { time: '08:00', days: [] }).ok).toBe(false);
    expect(scheduleToCron('weekly', { time: '08:00', days: [9] }).ok).toBe(false);
  });

  it('错误里带得出人话原因（直接进表单红字）', () => {
    const r = scheduleToCron('weekly', { time: '08:00', days: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('至少选择一天');
  });
});

describe('describeSchedule', () => {
  it('三种预设各自的人话', () => {
    expect(describeSchedule('daily', { time: '08:00' })).toBe('每天 08:00');
    expect(describeSchedule('hourly', { minute: 5 })).toBe('每小时 :05');
    expect(describeSchedule('weekly', { time: '08:00', days: [1, 3, 5] })).toBe('每周一三五 08:00');
  });
});
