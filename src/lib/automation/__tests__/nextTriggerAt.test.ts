// 下一次触发时刻（F21-7 §7.1 `nextTriggerAt` 四条 / §9.1 #9、#31）。
import { describe, it, expect } from 'vitest';
import { nextTriggerAt, describeScheduleWithZone } from '@/lib/automation/nextTriggerAt';

const SH = 'Asia/Shanghai';
const NY = 'America/New_York';

describe('nextTriggerAt · 基本求值', () => {
  it('每天 08:00：当天还没到 → 当天；已过 → 次日', () => {
    // 上海 2026-08-31 06:00 = 2026-08-30T22:00Z
    const before = Date.parse('2026-08-30T22:00:00Z');
    expect(nextTriggerAt('daily', { time: '08:00' }, SH, before)).toBe(
      Date.parse('2026-08-31T00:00:00Z'),
    );
    // 上海 2026-08-31 09:00 = 2026-08-31T01:00Z ⇒ next 是 9-1 08:00
    const after = Date.parse('2026-08-31T01:00:00Z');
    expect(nextTriggerAt('daily', { time: '08:00' }, SH, after)).toBe(
      Date.parse('2026-09-01T00:00:00Z'),
    );
  });

  it('严格晚于：恰好等于触发时刻时给下一次，不给"现在"（否则同一时刻会被反复触发）', () => {
    const exact = Date.parse('2026-08-31T00:00:00Z'); // 上海 08:00 整
    expect(nextTriggerAt('daily', { time: '08:00' }, SH, exact)).toBe(
      Date.parse('2026-09-01T00:00:00Z'),
    );
  });

  it('每小时 :30', () => {
    const now = Date.parse('2026-08-31T01:10:00Z');
    expect(nextTriggerAt('hourly', { minute: 30 }, SH, now)).toBe(
      Date.parse('2026-08-31T01:30:00Z'),
    );
    const past = Date.parse('2026-08-31T01:40:00Z');
    expect(nextTriggerAt('hourly', { minute: 30 }, SH, past)).toBe(
      Date.parse('2026-08-31T02:30:00Z'),
    );
  });

  it('每周一三五 08:00：从周一 09:00 出发落到周三', () => {
    // 2026-08-31 是周一。上海 09:00 = 01:00Z。
    const monday = Date.parse('2026-08-31T01:00:00Z');
    const next = nextTriggerAt('weekly', { time: '08:00', days: [1, 3, 5] }, SH, monday);
    // 周三 2026-09-02 上海 08:00 = 2026-09-02T00:00Z
    expect(next).toBe(Date.parse('2026-09-02T00:00:00Z'));
  });
});

describe('nextTriggerAt · ⭐ 只用规则自带的时区快照求值', () => {
  it('同一 (schedule, after)，换时区 → 结果不同；换的是规则的时区，不是机器的', () => {
    const after = Date.parse('2026-08-30T22:00:00Z');
    const sh = nextTriggerAt('daily', { time: '08:00' }, SH, after);
    const ny = nextTriggerAt('daily', { time: '08:00' }, NY, after);
    expect(sh).toBe(Date.parse('2026-08-31T00:00:00Z')); // 上海 08:00
    expect(ny).toBe(Date.parse('2026-08-31T12:00:00Z')); // 纽约 08:00 EDT
    expect(sh).not.toBe(ny);
  });

  // ★ 结构性断言（比"改 process.env.TZ 结果不变"更强，见 timeZone.test.ts 同名 describe）：
  //   本函数只要有一处读了本地时间，这条就红。
  it('⭐ 结构性：全程不读本地时间读取器', () => {
    // ⚠️ 用 Reflect 而不是 `as unknown as Record<...>`：双重断言是本仓的 lint 硬禁（14 §4），
    //    而 Reflect.get/set 本来就是"按名字读写属性"的正当接口，不需要绕过类型系统。
    const names = ['getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getTimezoneOffset'];
    const saved = names.map((n) => [n, Reflect.get(Date.prototype, n)] as const);
    for (const n of names) {
      Reflect.set(Date.prototype, n, () => {
        throw new Error(`不许读本地时间：${n}`);
      });
    }
    try {
      expect(
        nextTriggerAt(
          'weekly',
          { time: '08:00', days: [1, 3, 5] },
          SH,
          Date.parse('2026-08-31T01:00:00Z'),
        ),
      ).toBe(Date.parse('2026-09-02T00:00:00Z'));
    } finally {
      for (const [n, fn] of saved) {
        Reflect.set(Date.prototype, n, fn);
      }
    }
  });
});

describe('nextTriggerAt · DST（本地墙钟语义，不重复不跳过）', () => {
  it('春季跳表日：每天 02:30 仍触发一次（顺移到 03:30），不被跳过', () => {
    // 2026-03-07 美东 12:00 EST = 17:00Z 出发 ⇒ 下一次是 3-8 的 02:30（不存在）。
    const after = Date.parse('2026-03-07T17:00:00Z');
    const next = nextTriggerAt('daily', { time: '02:30' }, NY, after);
    expect(next).toBe(Date.parse('2026-03-08T07:30:00Z')); // = 当地 03:30 EDT
  });

  it('秋季回拨日：每天 01:30 只触发一次（取第一次出现），不重复', () => {
    const after = Date.parse('2026-10-31T17:00:00Z'); // 10-31 13:00 EDT
    const next = nextTriggerAt('daily', { time: '01:30' }, NY, after);
    expect(next).toBe(Date.parse('2026-11-01T05:30:00Z')); // 第一次的 01:30 EDT
    // 紧接着的下一次必须是 11-2，而不是同一天第二个 01:30 EST。
    const after2 = nextTriggerAt('daily', { time: '01:30' }, NY, next ?? 0);
    expect(after2).toBe(Date.parse('2026-11-02T06:30:00Z')); // 11-2 01:30 EST
  });
});

describe('nextTriggerAt · 降频与非法输入', () => {
  it('降频态：weekly 规则按每日一次求解，但沿用原时刻（03 §8.4）', () => {
    const monday = Date.parse('2026-08-31T01:00:00Z'); // 周一 09:00 上海
    const normal = nextTriggerAt('weekly', { time: '08:00', days: [1] }, SH, monday);
    const degraded = nextTriggerAt('weekly', { time: '08:00', days: [1] }, SH, monday, {
      degraded: true,
    });
    // 正常：下周一；降频：明天（还是 08:00，只是频率压到每天）。
    expect(normal).toBe(Date.parse('2026-09-07T00:00:00Z'));
    expect(degraded).toBe(Date.parse('2026-09-01T00:00:00Z'));
  });

  it('非法调度配置 / 非法时区 → undefined，不抛（表单每次按键都会调它）', () => {
    const now = Date.parse('2026-08-31T00:00:00Z');
    expect(nextTriggerAt('daily', {}, SH, now)).toBeUndefined();
    expect(nextTriggerAt('daily', { time: '25:00' }, SH, now)).toBeUndefined();
    expect(nextTriggerAt('hourly', { minute: 99 }, SH, now)).toBeUndefined();
    expect(nextTriggerAt('weekly', { time: '08:00', days: [] }, SH, now)).toBeUndefined();
    expect(nextTriggerAt('daily', { time: '08:00' }, 'Mars/Olympus', now)).toBeUndefined();
  });
});

describe('describeScheduleWithZone', () => {
  it('时区永远跟着一起显示', () => {
    expect(describeScheduleWithZone('daily', { time: '08:00' }, SH)).toBe(
      '每天 08:00（Asia/Shanghai）',
    );
    expect(describeScheduleWithZone('weekly', { time: '08:00', days: [1, 3, 5] }, SH)).toContain(
      '每周一三五 08:00',
    );
  });
});
