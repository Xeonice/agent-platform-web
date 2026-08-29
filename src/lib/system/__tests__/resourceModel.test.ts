// F21-5 §7.1 `lib/overallResourceLevel` + 单位换算 + 保留卷倒计时。
import { describe, it, expect } from 'vitest';
import {
  formatAmount,
  formatBytes,
  formatRetainedCountdown,
  overallResourceLevel,
  resourcePoolModel,
} from '@/lib/system/resourceModel';
import type { SystemResourcesDto } from '@/types/system';

const GB = 1024 ** 3;

function resources(over: Partial<SystemResourcesDto> = {}): SystemResourcesDto {
  return {
    cpu: { cores: 8, loadAvg1m: 0.8, usedPercent: 10, level: 'ok' },
    ram: { totalBytes: 16 * GB, usedBytes: 3.2 * GB, usedPercent: 20, level: 'ok' },
    disk: {
      path: '/data',
      totalBytes: 200 * GB,
      usedBytes: 196 * GB,
      availableBytes: 4 * GB,
      usedPercent: 98,
      level: 'critical',
      reservedPercent: 15,
    },
    retainedVolumes: {
      count: 0,
      totalBytes: 0,
      percentOfDisk: 0,
      level: 'ok',
      truncated: false,
    },
    activeTasks: 3,
    ...over,
  };
}

describe('overallResourceLevel —— 取最差维度，不是平均', () => {
  it('⭐ `{cpu:ok, ram:ok, disk:critical}` ⇒ critical（平均会算成健康，而那正是最该拦住新建 Task 的时刻）', () => {
    // ⚠️ 本文件的核心用例（审计 P1-9）。改成"多数表决"或"平均"之后，
    //    这台盘已经 98% 的机器会显示「资源充足」——而它一个 Task 都建不出来。
    expect(overallResourceLevel(['ok', 'ok', 'critical'])).toBe('critical');
    // ⚠️ 位置也换一遍：只测"最差的排在最后"那一种排列时，一个"取最后一个"的实现
    //    （比 `>` 写成 `>=` 还更常见）照样绿。
    expect(overallResourceLevel(['critical', 'ok', 'ok'])).toBe('critical');
    expect(overallResourceLevel(['ok', 'critical', 'ok'])).toBe('critical');
  });

  it('三项全 ok ⇒ ok；有 warn 无 critical ⇒ warn（不会被"最差"这条规则一路顶到 critical）', () => {
    expect(overallResourceLevel(['ok', 'ok', 'ok'])).toBe('ok');
    expect(overallResourceLevel(['ok', 'warn', 'ok'])).toBe('warn');
  });

  it('critical 压过 warn（顺序无关，两种排列都试）', () => {
    expect(overallResourceLevel(['critical', 'warn'])).toBe('critical');
    expect(overallResourceLevel(['warn', 'critical'])).toBe('critical');
  });

  it('空输入 ⇒ ok（"没有维度可判" ≠ "有维度坏了"，不许崩也不许报红）', () => {
    expect(overallResourceLevel([])).toBe('ok');
  });
});

describe('单位换算', () => {
  it('已用与总量同单位（`150 / 200 GB`）—— 两个数不同单位就没法一眼比大小', () => {
    expect(formatAmount(150 * GB, 200 * GB)).toBe('150 / 200 GB');
  });

  it('小容量退到 MB / KB，不会硬凑成 `0 GB`', () => {
    expect(formatAmount(300 * 1024 * 1024, 512 * 1024 * 1024)).toBe('300 / 512 MB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(0)).toBe('0 B');
  });
});

describe('保留卷倒计时（整数天向下取整）', () => {
  const now = new Date('2026-08-28T12:00:00.000Z');

  it('6 天多 ⇒ 「还需 6 天」（向下取整，不四舍五入到 7）', () => {
    expect(formatRetainedCountdown('2026-09-03T20:00:00.000Z', now)).toBe(
      '最早的成果还需 6 天清理',
    );
  });

  it('不足 1 天 ⇒ 「不足 1 天」而不是「还需 0 天」', () => {
    expect(formatRetainedCountdown('2026-08-29T06:00:00.000Z', now)).toBe(
      '最早的成果不足 1 天后清理',
    );
  });

  it('已过期 ⇒ 「即将清理」，⛔ 不显示负数天（会让人以为界面坏了）', () => {
    expect(formatRetainedCountdown('2026-08-20T00:00:00.000Z', now)).toBe('最早的成果即将清理');
  });

  it('时间串解析不出来 ⇒ 不产出（占位符属 view 决定，不在这里编一个 "—"）', () => {
    expect(formatRetainedCountdown('not-a-date', now)).toBeUndefined();
  });
});

describe('resourcePoolModel', () => {
  const now = new Date('2026-08-28T12:00:00.000Z');

  it('⭐ 每个维度的档次取**后端**的 `level`，不在前端按百分比重算', () => {
    // ⚠️ 这条守的是"两套阈值"这件事：磁盘用 75/90、CPU/RAM 用 80/95。
    //    前端若照 F21-5 §6 那句"均 <80%" 重算一遍，78% 的磁盘会被算成 ok
    //    —— 与后端下发的 warn 当场打架。这里给一个**故意不自洽**的输入来钉住"照抄"。
    const model = resourcePoolModel(
      resources({
        disk: {
          path: '/data',
          totalBytes: 200 * GB,
          usedBytes: 156 * GB,
          availableBytes: 44 * GB,
          usedPercent: 78,
          level: 'warn',
          reservedPercent: 15,
        },
      }),
      now,
    );
    expect(model.gauges.map((g) => g.level)).toEqual(['ok', 'ok', 'warn']);
    expect(model.overallLevel).toBe('warn');
  });

  it('整体文案说出**下一步动作**（三档三句，互不相同）', () => {
    expect(resourcePoolModel(resources(), now).overallText).toBe('资源耗尽，无法创建新 Task');
    const ok = resourcePoolModel(
      resources({
        disk: {
          path: '/data',
          totalBytes: 200 * GB,
          usedBytes: 20 * GB,
          availableBytes: 180 * GB,
          usedPercent: 10,
          level: 'ok',
          reservedPercent: 15,
        },
      }),
      now,
    );
    expect(ok.overallText).toBe('资源充足');
    // 否定断言：三句必须互不覆盖，否则"资源耗尽"那句会在健康时也渲染出来。
    expect(ok.overallText).not.toContain('无法创建新 Task');
  });

  it('CPU 那一格用核数不用字节（`0.8 / 8 核`）', () => {
    expect(resourcePoolModel(resources(), now).gauges[0]?.amountText).toBe('0.8 / 8 核');
  });

  it('[清理保留卷] 挂在**磁盘/保留卷**维度上：磁盘 ok + 保留卷 ok ⇒ 不出现', () => {
    const healthy = resourcePoolModel(
      resources({
        disk: {
          path: '/data',
          totalBytes: 200 * GB,
          usedBytes: 20 * GB,
          availableBytes: 180 * GB,
          usedPercent: 10,
          level: 'ok',
          reservedPercent: 15,
        },
      }),
      now,
    );
    expect(healthy.showCleanupRetained).toBe(false);
    // 磁盘告警 ⇒ 出现（停 Task 不释放保留卷，磁盘要有自己的出路）。
    expect(resourcePoolModel(resources(), now).showCleanupRetained).toBe(true);
    // 保留卷自己超阈值也要出现，哪怕磁盘还 ok。
    const retainedWarn = resourcePoolModel(
      resources({
        disk: {
          path: '/data',
          totalBytes: 200 * GB,
          usedBytes: 20 * GB,
          availableBytes: 180 * GB,
          usedPercent: 10,
          level: 'ok',
          reservedPercent: 15,
        },
        retainedVolumes: {
          count: 30,
          totalBytes: 160 * GB,
          percentOfDisk: 80,
          level: 'warn',
          truncated: false,
        },
      }),
      now,
    );
    expect(retainedWarn.showCleanupRetained).toBe(true);
  });

  it('`truncated` 原样透出 —— 截断了还报一个确切数字，用户清完发现对不上就再也不信它', () => {
    const model = resourcePoolModel(
      resources({
        retainedVolumes: {
          count: 999,
          totalBytes: 45 * GB,
          percentOfDisk: 22.5,
          level: 'ok',
          truncated: true,
        },
      }),
      now,
    );
    expect(model.retained.truncated).toBe(true);
    expect(model.retained.sizeText).toBe('45 GB');
  });

  it('没有保留卷 ⇒ 不产出倒计时字段（占位符属 view 决定）', () => {
    expect(resourcePoolModel(resources(), now).retained.countdownText).toBeUndefined();
  });
});
