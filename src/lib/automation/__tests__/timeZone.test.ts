// 时区快照运算（03 §8.1 / 23 I-AUT-9）。
import { describe, it, expect, afterEach } from 'vitest';
import {
  InvalidTimeZoneError,
  formatInZone,
  wallClockOf,
  wallClockToUtc,
  zoneOffsetMs,
  zonedWeekday,
} from '@/lib/automation/timeZone';

const SH = 'Asia/Shanghai';
const NY = 'America/New_York';

describe('wallClockOf / zoneOffsetMs', () => {
  it('按指定时区拆墙钟，不按本机', () => {
    // 2026-08-31T00:00:00Z = 上海 08:00、纽约 20:00（前一天）。
    const utc = Date.parse('2026-08-31T00:00:00Z');
    expect(wallClockOf(utc, SH)).toMatchObject({ year: 2026, month: 8, day: 31, hour: 8 });
    expect(wallClockOf(utc, NY)).toMatchObject({ month: 8, day: 30, hour: 20 });
  });

  it('偏移随 DST 变化（同一时区、两个季节两个值）', () => {
    expect(zoneOffsetMs(Date.parse('2026-01-15T12:00:00Z'), NY)).toBe(-5 * 3600_000);
    expect(zoneOffsetMs(Date.parse('2026-07-15T12:00:00Z'), NY)).toBe(-4 * 3600_000);
    // 上海没有 DST，全年恒 +8。
    expect(zoneOffsetMs(Date.parse('2026-01-15T12:00:00Z'), SH)).toBe(8 * 3600_000);
  });

  it('非法时区抛 InvalidTimeZoneError —— ⛔ 不静默回落到本机时区', () => {
    expect(() => wallClockOf(0, 'Mars/Olympus')).toThrow(InvalidTimeZoneError);
  });
});

describe('wallClockToUtc · DST 两个边界', () => {
  const wall = (day: number, hour: number, minute: number) => ({
    year: 2026,
    month: 3,
    day,
    hour,
    minute,
    second: 0,
  });

  it('普通日：墙钟 → UTC 往返一致', () => {
    const utc = wallClockToUtc(wall(1, 2, 30), NY);
    expect(wallClockOf(utc, NY)).toMatchObject({ month: 3, day: 1, hour: 2, minute: 30 });
  });

  it('⭐ 春季跳表：当地 02:30 那天不存在 → 顺移到切换后，**不跳过这一天**', () => {
    // 2026-03-08 美东 02:00 → 03:00。02:30 是不存在的墙钟。
    const utc = wallClockToUtc(wall(8, 2, 30), NY);
    const back = wallClockOf(utc, NY);
    expect(back.day).toBe(8);
    // 顺移到 03:30 EDT（= 07:30Z），⛔ 不是回落到 01:30 EST（那会让任务提前一小时跑）。
    expect(back.hour).toBe(3);
    expect(utc).toBe(Date.parse('2026-03-08T07:30:00Z'));
  });

  // ⭐⭐ 这一条是**变异测试逼出来的**（M8：把候选选择整段换成 `Math.max`，131 条用例全绿）。
  //     根因不是"少了一条断言"，而是**只测了西区**：旧实现的两趟迭代在西区（NY）收敛到
  //     第一次出现、在东区（Berlin）收敛到**第二次**，两者行为相反而文件头只写了"取第一次"。
  //     ⇒ 东西两区各钉一条，语义（"回拨只跑一次，且是第一次那一刻"）才真正被锁住。
  it('⭐⭐ 秋季回拨 · 东区（Europe/Berlin）：当地 02:30 出现两次 → 取第一次', () => {
    // 2026-10-25 柏林 03:00 → 02:00（CEST +2 → CET +1）。
    // 02:30 出现两次：00:30Z（CEST）与 01:30Z（CET）。
    const utc = wallClockToUtc(
      { year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 0 },
      'Europe/Berlin',
    );
    expect(utc).toBe(Date.parse('2026-10-25T00:30:00Z'));
    expect(wallClockOf(utc, 'Europe/Berlin')).toMatchObject({ hour: 2, minute: 30 });
  });

  it('⭐ 春季跳表 · 东区（Europe/Berlin）：当地 02:30 不存在 → 顺移，不跳过', () => {
    // 2026-03-29 柏林 02:00 → 03:00。
    const utc = wallClockToUtc(
      { year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0 },
      'Europe/Berlin',
    );
    expect(wallClockOf(utc, 'Europe/Berlin')).toMatchObject({ day: 29, hour: 3, minute: 30 });
  });

  it('⭐ 秋季回拨 · 西区（America/New_York）：当地 01:30 出现两次 → 取第一次，**不重复触发**', () => {
    // 2026-11-01 美东 02:00 → 01:00。01:30 出现两次（05:30Z EDT 与 06:30Z EST）。
    const utc = wallClockToUtc(
      { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 },
      NY,
    );
    expect(utc).toBe(Date.parse('2026-11-01T05:30:00Z'));
    expect(wallClockOf(utc, NY)).toMatchObject({ hour: 1, minute: 30 });
  });
});

describe('zonedWeekday / formatInZone', () => {
  it('星期按该时区的日历算（跨零点会与 UTC 差一天）', () => {
    // 2026-08-31T20:00Z：上海已是 9-1（周二），纽约仍是 8-31（周一）。
    const utc = Date.parse('2026-08-31T20:00:00Z');
    expect(zonedWeekday(utc, SH)).toBe(2);
    expect(zonedWeekday(utc, NY)).toBe(1);
  });

  it('格式化用规则的时区，不用本机', () => {
    const utc = Date.parse('2026-08-10T00:00:00Z');
    expect(formatInZone(utc, SH)).toBe('8-10 08:00');
    expect(formatInZone(utc, 'UTC')).toBe('8-10 00:00');
  });
});

// ★★ 结构性断言：把 `Date.prototype` 上**所有读本地时间的方法**换成会抛的替身，
//    本模块仍须正常工作。这比"换个 TZ 跑一遍结果相同"更强：
//    后者在 Node 里因为 ICU 缓存经常测不出真差别，而这一条只要有人写了一个
//    `d.getHours()`，测试**当场就红**。
describe('⭐ 结构性：本模块不读运行环境时区', () => {
  const LOCAL_READERS = [
    'getFullYear',
    'getMonth',
    'getDate',
    'getDay',
    'getHours',
    'getMinutes',
    'getSeconds',
    'getTimezoneOffset',
    'toLocaleString',
    'toLocaleDateString',
    'toLocaleTimeString',
  ] as const;
  const saved = new Map<string, unknown>();

  afterEach(() => {
    for (const [name, fn] of saved) {
      Reflect.set(Date.prototype, name, fn);
    }
    saved.clear();
  });

  it('墙钟运算全程不碰本地时间读取器', () => {
    // ⚠️ Reflect 而不是双重断言（14 §4 硬禁），理由见 nextTriggerAt.test.ts 同名用例。
    for (const name of LOCAL_READERS) {
      saved.set(name, Reflect.get(Date.prototype, name));
      Reflect.set(Date.prototype, name, () => {
        throw new Error(`不许读本地时间：Date.prototype.${name}`);
      });
    }

    const utc = Date.parse('2026-08-31T00:00:00Z');
    expect(() => wallClockOf(utc, SH)).not.toThrow();
    expect(() => zoneOffsetMs(utc, SH)).not.toThrow();
    expect(() => zonedWeekday(utc, SH)).not.toThrow();
    expect(formatInZone(utc, SH)).toBe('8-31 08:00');
    expect(
      wallClockToUtc({ year: 2026, month: 8, day: 31, hour: 8, minute: 0, second: 0 }, SH),
    ).toBe(utc);
  });
});
