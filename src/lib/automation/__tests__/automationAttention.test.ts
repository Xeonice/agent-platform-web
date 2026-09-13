// 自动化侧的横幅判定（P21-7 §4 / §5 / F21-7 §9.1 #20 #24）。
import { describe, it, expect } from 'vitest';
import { automationAttention } from '@/lib/automation/automationAttention';
import type { AutomationDto } from '@/types/automation';

function rule(overrides: Partial<AutomationDto> = {}): AutomationDto {
  return {
    id: 'a1',
    projectId: 'p1',
    name: '每天凌晨数据分析',
    runtime: 'codex',
    prompt: 'x',
    scheduleKind: 'daily',
    scheduleConfig: { time: '08:00' },
    timezone: 'Asia/Shanghai',
    timeoutMinutes: 120,
    artifactRetentionDays: 7,
    enabled: true,
    degraded: false,
    consecutiveFailures: 0,
    triggerOn: 'failure',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('automationAttention', () => {
  /**
   * ★ **「没拉到」≠「没有问题」。**
   *
   * 规则列表是按项目、面板打开才拉的，所以大多数时刻根本没有数据。把那一刻当成
   * "一切正常"静默掉，横幅就永远不会为一个从不打开面板的人亮起 —— 而那个人正是
   * 这条横幅唯一要服务的对象。⇒ 两种情况的返回值必须分得开。
   */
  it('⭐ undefined（还没拉过）⇒ hasData:false，⛔ 不等于「没有问题」', () => {
    const unknown = automationAttention(undefined);
    const known = automationAttention([]);
    expect(unknown.hasData).toBe(false);
    expect(known.hasData).toBe(true);
    // 两者的 needsAttention 都是 false，但**理由不同**，调用方要能分辨。
    expect(unknown.hasData).not.toBe(known.hasData);
  });

  it('全都正常 ⇒ 不提示，也不产出文案（横幅层据此不 push）', () => {
    const a = automationAttention([rule(), rule({ id: 'a2' })]);
    expect(a.needsAttention).toBe(false);
    expect(a.title).toBeUndefined();
    expect(a.description).toBeUndefined();
  });

  it('自动停用的规则被数出来，并说明「不会再触发」+「要重新开启」', () => {
    const a = automationAttention([
      rule({ id: 'a1', enabled: false, degraded: true, consecutiveFailures: 10 }),
      rule({ id: 'a2' }),
    ]);
    expect(a.autoDisabledCount).toBe(1);
    expect(a.degradedCount).toBe(0);
    expect(a.needsAttention).toBe(true);
    expect(a.title).toContain('1 条');
    expect(a.title).toContain('自动停用');
    expect(a.description).toContain('不再触发');
    expect(a.description).toContain('重新开启');
  });

  /**
   * ⚠️ 手动关掉的规则**不进这个计数**：那是用户自己关的，提醒他"你关了一条规则"
   * 是纯噪音。判据复用 `automationLifecycle`（自动停用先判），⛔ 不在这里重写。
   */
  it('手动关掉的规则不算「需要注意」（那是用户自己的决定）', () => {
    const a = automationAttention([
      rule({ id: 'a1', enabled: false, degraded: false, consecutiveFailures: 0 }),
    ]);
    expect(a.needsAttention).toBe(false);
    expect(a.autoDisabledCount).toBe(0);
  });

  it('被放慢的规则单独一档（还在跑，只是慢了）', () => {
    const a = automationAttention([rule({ degraded: true, consecutiveFailures: 3 })]);
    expect(a.degradedCount).toBe(1);
    expect(a.autoDisabledCount).toBe(0);
    expect(a.title).toContain('放慢');
    expect(a.description).toContain('每天只试一次');
  });

  /** 标题只说最重的那一档；两档都有时，描述里两件事都要说全。 */
  it('两档同时存在 ⇒ 标题说自动停用，描述里两件事都不省', () => {
    const a = automationAttention([
      rule({ id: 'a1', enabled: false, degraded: true, consecutiveFailures: 12 }),
      rule({ id: 'a2', degraded: true, consecutiveFailures: 4 }),
    ]);
    expect(a.title).toContain('自动停用');
    expect(a.description).toContain('不再触发');
    expect(a.description).toContain('放慢');
  });

  /** ★ 横幅存在的理由要写在文案里：别处不会再提醒第二次。 */
  it('描述里明说「这里是唯一会主动告诉你的地方」', () => {
    const a = automationAttention([
      rule({ enabled: false, degraded: true, consecutiveFailures: 10 }),
    ]);
    expect(a.description).toContain('唯一会主动告诉你');
  });
});
