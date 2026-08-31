// DTO → 视图模型（F21-7 §6）。
import { describe, it, expect } from 'vitest';
import {
  automationRow,
  automationRows,
  dedupeRunsById,
  runRows,
} from '@/lib/automation/automationModel';
import type { AutomationDto, AutomationRunDto } from '@/types/automation';

const NOW = Date.parse('2026-08-31T01:00:00Z'); // 上海 09:00

function dto(overrides: Partial<AutomationDto> = {}): AutomationDto {
  return {
    id: 'auto-1',
    projectId: 'proj-1',
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

describe('automationRow', () => {
  it('摘要是 runtime + 人话调度', () => {
    expect(automationRow(dto(), NOW, 'Asia/Shanghai').summaryText).toBe('codex · 每天 08:00');
  });

  it('⭐ 时区永远在行上（缺了它，用户换台机器会以为触发时刻漂了）', () => {
    const row = automationRow(dto(), NOW, 'Asia/Shanghai');
    expect(row.timezone).toBe('Asia/Shanghai');
  });

  it('⭐ 环境时区与规则时区不同 → 多一句提醒；相同 → 不提醒（一致还提醒是噪音）', () => {
    expect(automationRow(dto(), NOW, 'America/New_York').timezoneNote).toContain('Asia/Shanghai');
    expect(automationRow(dto(), NOW, 'Asia/Shanghai').timezoneNote).toBeUndefined();
  });

  it('⭐ 下次触发时间按**规则的时区**格式化，不按环境时区', () => {
    const row = automationRow(dto(), NOW, 'America/New_York');
    // 上海 9-1 08:00，无论读它的人在哪个时区，显示的都是这个。
    expect(row.nextTriggerText).toBe('9-1 08:00');
  });

  it('⭐ 后端给了 nextTriggerAt 就用后端的（它才是调度器真会用的时刻）', () => {
    const row = automationRow(dto({ nextTriggerAt: '2026-09-05T00:00:00Z' }), NOW, 'Asia/Shanghai');
    expect(row.nextTriggerText).toBe('9-5 08:00');
  });

  it('⭐ 禁用 / 自动禁用不显示下次触发时间（它不会触发，给一个时刻是误导）', () => {
    expect(
      automationRow(dto({ enabled: false, nextTriggerAt: '2026-09-05T00:00:00Z' }), NOW, 'UTC')
        .nextTriggerText,
    ).toBeUndefined();
    expect(
      automationRow(
        dto({
          enabled: false,
          degraded: true,
          consecutiveFailures: 10,
          nextTriggerAt: '2026-09-05T00:00:00Z',
        }),
        NOW,
        'UTC',
      ).nextTriggerText,
    ).toBeUndefined();
  });

  it('非法时区 → 不显示时刻，也不回落成本机时区凑一个数', () => {
    const row = automationRow(dto({ timezone: 'Mars/Olympus' }), NOW, 'UTC');
    expect(row.nextTriggerText).toBeUndefined();
    expect(row.timezone).toBe('Mars/Olympus');
  });

  it('四态图标齐（🟡/🔴 需要处置）', () => {
    expect(automationRows([dto()], NOW, 'UTC')[0]?.icon).toBe('✅');
    expect(automationRows([dto({ enabled: false })], NOW, 'UTC')[0]?.icon).toBe('⏸️');
    expect(
      automationRows([dto({ degraded: true, consecutiveFailures: 3 })], NOW, 'UTC')[0],
    ).toMatchObject({ icon: '🟡', needsAttention: true });
    expect(
      automationRows(
        [dto({ enabled: false, degraded: true, consecutiveFailures: 10 })],
        NOW,
        'UTC',
      )[0],
    ).toMatchObject({ icon: '🔴', needsAttention: true });
  });
});

describe('runRows', () => {
  function run(overrides: Partial<AutomationRunDto> = {}): AutomationRunDto {
    return {
      id: 'run-1',
      automationId: 'auto-1',
      status: 'success',
      retryCount: 0,
      triggeredAt: '2026-08-31T00:00:00Z',
      startedAt: '2026-08-31T00:00:00Z',
      ...overrides,
    };
  }

  /**
   * ⭐⭐ `missed` / `skipped` **没有 `startedAt`** —— 13 §2.7.2 里 `started_at` 可空，
   * 因为它们根本没有「开始执行」那一刻。而这两类恰恰最需要时间：用户要看的正是
   * 「什么时候错过的」。
   *
   * ⚠️ 少了这条用例，把实现改回 `Date.parse(run.startedAt)` **照样全绿** —— 因为其它
   * fixture 里两个字段是同一个值，读哪个都一样。那时界面上这一格会渲染出 `undefined`：
   * 不报错、不告警，只是那一行看起来坏了。（2026-08-31 联合验证撞出，变异存活后补。）
   */
  it('⭐⭐ missed 没有 startedAt ⇒ 时间取 triggeredAt，不渲染 undefined', () => {
    const rows = runRows(
      [
        {
          id: 'r-missed',
          automationId: 'a1',
          status: 'missed',
          retryCount: 0,
          triggeredAt: '2026-08-31T02:00:00Z',
          // ⛔ 故意不给 startedAt —— 这就是 missed 的真实形状
        },
      ],
      'UTC',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.startedAtText).not.toContain('undefined');
    expect(rows[0]?.startedAtText).not.toBe('');
    // 取的必须是 triggeredAt 那个时刻（02:00），不是别的
    expect(rows[0]?.startedAtText).toContain('02');
  });

  it('⭐ 触发时刻按规则时区渲染', () => {
    expect(runRows([run()], 'Asia/Shanghai')[0]?.startedAtText).toBe('8-31 08:00');
    expect(runRows([run()], 'UTC')[0]?.startedAtText).toBe('8-31 00:00');
  });

  it('缺 sandboxId → 不给 [打开 Task] 的落点（不摆点了没反应的按钮）', () => {
    expect(runRows([run()], 'UTC')[0]?.sandboxId).toBeUndefined();
    expect(runRows([run({ sandboxId: 'sbx-1' })], 'UTC')[0]?.sandboxId).toBe('sbx-1');
  });

  it('未结束 → 无耗时文案', () => {
    expect(runRows([run({ status: 'running' })], 'UTC')[0]?.durationText).toBeUndefined();
    expect(runRows([run({ durationMs: 72_000 })], 'UTC')[0]?.durationText).toBe('1 分 12 秒');
  });
});

describe('⭐⭐ dedupeRunsById · offset 分页在"头部追加"列表上的必然重复', () => {
  function r(id: string): AutomationRunDto {
    return {
      id,
      automationId: 'a',
      status: 'success',
      retryCount: 0,
      triggeredAt: '2026-08-31T00:00:00Z',
      startedAt: '2026-08-31T00:00:00Z',
    };
  }

  it('第 2 页与第 1 页尾部重叠时，渲染列表里不出现重复 id，也不丢任何一条', () => {
    // 现场还原：page1 拉回来之后，中间新记了 3 条运行 ⇒ page2 的头 3 条正是 page1 的尾 3 条。
    const page1 = ['r20', 'r19', 'r18', 'r17', 'r16'].map(r);
    const page2 = ['r18', 'r17', 'r16', 'r15', 'r14'].map(r);
    const merged = dedupeRunsById([page1, page2]);
    const ids = merged.map((x) => x.id);
    expect(ids).toEqual(['r20', 'r19', 'r18', 'r17', 'r16', 'r15', 'r14']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('无重叠时原样拼接（去重不会顺手改变顺序或丢条目）', () => {
    const merged = dedupeRunsById([[r('a'), r('b')], [r('c')]]);
    expect(merged.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('空页 / 空输入不炸', () => {
    expect(dedupeRunsById([])).toEqual([]);
    expect(dedupeRunsById([[], []])).toEqual([]);
  });
});
