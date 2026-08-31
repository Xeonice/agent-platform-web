// 8 个 run status 的界面归类（F21-7 §7.1 `formatRunOutcome` / §6 状态矩阵）。
import { describe, it, expect } from 'vitest';
import {
  describeWebhookStatus,
  formatDuration,
  formatRunOutcome,
} from '@/lib/automation/formatRunOutcome';
import { AUTOMATION_RUN_STATUSES } from '@/types/automation';

describe('formatRunOutcome · 8 个 status 全覆盖', () => {
  it('每个 status 都有图标、标签、人话', () => {
    for (const status of AUTOMATION_RUN_STATUSES) {
      const o = formatRunOutcome({ status });
      expect(o.icon).not.toBe('');
      expect(o.label).not.toBe('');
      expect(o.detail.length).toBeGreaterThan(5);
    }
  });

  it('⭐ 只有 failed / timeout 计入连续失败（P21-7 §4 计数口径）', () => {
    const counting = AUTOMATION_RUN_STATUSES.filter(
      (s) => formatRunOutcome({ status: s }).countsTowardFailure,
    );
    expect([...counting].sort()).toEqual(['failed', 'timeout']);
  });

  it('⭐ 四类结果各占一个 category：跑挂了 / 没跑 / 在路上 / 好', () => {
    expect(formatRunOutcome({ status: 'success' }).category).toBe('success');
    expect(formatRunOutcome({ status: 'failed' }).category).toBe('failure');
    expect(formatRunOutcome({ status: 'timeout' }).category).toBe('failure');
    expect(formatRunOutcome({ status: 'skipped' }).category).toBe('skipped');
    // ⭐ missed 自成一类，**不能与 skipped 合并**：一个是"平台没跑"，一个是"决定不跑"。
    expect(formatRunOutcome({ status: 'missed' }).category).toBe('missed');
    expect(formatRunOutcome({ status: 'resource-exhausted' }).category).toBe('waiting');
    expect(formatRunOutcome({ status: 'pending' }).category).toBe('waiting');
    expect(formatRunOutcome({ status: 'running' }).category).toBe('running');
  });

  it('⭐ missed 的文案必须说清"不是规则失败"且"不补跑"（最容易被误读的一个）', () => {
    const o = formatRunOutcome({ status: 'missed' });
    expect(o.detail).toContain('不是规则失败');
    expect(o.detail).toContain('不会补跑');
    expect(o.countsTowardFailure).toBe(false);
    // 与 failed 的文案必须不同 —— 同一句话说两件事就等于没区分。
    expect(o.detail).not.toBe(formatRunOutcome({ status: 'failed' }).detail);
  });

  it('⭐ skipped 的两种 error_code 文案不同（AUTH_EXPIRED 要用户去授权，另一个什么都不用做）', () => {
    const auth = formatRunOutcome({ status: 'skipped', errorCode: 'AUTH_EXPIRED' });
    const prev = formatRunOutcome({ status: 'skipped', errorCode: 'PREVIOUS_RUNNING' });
    expect(auth.detail).not.toBe(prev.detail);
    expect(auth.detail).toContain('凭证');
    expect(prev.detail).toContain('上一次');
    // 缺 error_code（契约暂缺）时降级成通用文案，但仍说"不计入连续失败"。
    const unknown = formatRunOutcome({ status: 'skipped' });
    expect(unknown.detail).toContain('不计入连续失败');
    expect(unknown.detail).not.toBe(auth.detail);
  });

  it('resource-exhausted 显示「已排队 n/5」', () => {
    expect(formatRunOutcome({ status: 'resource-exhausted', retryCount: 3 }).label).toBe(
      '排队重试中 3/5',
    );
    expect(formatRunOutcome({ status: 'resource-exhausted' }).label).toBe('排队重试中 0/5');
  });

  it('timeout 的文案与 failed 不同（要引导去调超时档位，不是去查代码）', () => {
    const t = formatRunOutcome({ status: 'timeout' });
    expect(t.label).toBe('超时');
    expect(t.detail).toContain('超时档位');
    expect(t.detail).not.toBe(formatRunOutcome({ status: 'failed' }).detail);
  });
});

describe('describeWebhookStatus', () => {
  it('⭐ 投递失败的旁注必须说明"规则状态不受影响"（P21-7 §9.1 #30）', () => {
    const note = describeWebhookStatus('failed');
    expect(note).toBeDefined();
    expect(note).toContain('规则状态不受影响');
  });

  it('缺席 → undefined（不渲染一行空的 webhook 说明）', () => {
    expect(describeWebhookStatus(undefined)).toBeUndefined();
    expect(describeWebhookStatus('sent')).toContain('已送达');
    expect(describeWebhookStatus('skipped')).toContain('不发');
  });
});

describe('formatDuration', () => {
  it('毫秒 / 秒 / 分秒 / 时分', () => {
    expect(formatDuration(840)).toBe('840 毫秒');
    expect(formatDuration(12_000)).toBe('12 秒');
    expect(formatDuration(72_000)).toBe('1 分 12 秒');
    expect(formatDuration(7_200_000)).toBe('2 小时 0 分');
  });

  it('缺席 / 非法 → undefined（不渲染「耗时 NaN」）', () => {
    expect(formatDuration(undefined)).toBeUndefined();
    expect(formatDuration(Number.NaN)).toBeUndefined();
    expect(formatDuration(-1)).toBeUndefined();
  });
});
