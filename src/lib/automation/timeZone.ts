// IANA 时区下的墙钟运算（03 §8.1 时区快照语义 / 23 I-AUT-9）。
//
// ★ **本文件的全部函数都不读运行环境的时区。** 这不是"顺便做到的"，是它存在的理由：
// 规则的 `timezone` 是**创建时快照**的，此后无论平台跑在哪台机器、用户从哪个时区打开，
// 「每天凌晨 3 点」都必须还是那个时区的凌晨 3 点。任何一处 `getHours()` /
// `getTimezoneOffset()` / `toLocaleString()` 不带 `timeZone` 参数，都会把这条语义悄悄毁掉，
// 而且**在开发者自己的机器上永远看不出问题**（本机时区恰好就是规则时区）。
//
// ⇒ 唯一被允许的时间读取方式是 `Intl.DateTimeFormat` **显式传 `timeZone`**。
//   `lib/automation/__tests__/timeZone.test.ts` 里有一条结构性断言把这条钉死：
//   把 `Date.prototype` 上的本地时间读取器全换成会抛的替身，本文件的函数仍须正常工作。

/** 一个墙钟时刻的各字段（都是**指定时区**下的值，不是本地值）。 */
export interface WallClock {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number; // 0..23
  minute: number; // 0..59
  second: number;
}

/**
 * 时区非法（拼错的 IANA 名、后端给了空串）时抛出。
 * ⚠️ 刻意**不静默回落到本机时区**：那正是这一整套快照语义要防的事，
 * 回落之后界面照常渲染一个"看起来完全正常"的错误时刻。
 */
export class InvalidTimeZoneError extends Error {
  constructor(readonly timeZone: string) {
    super(`未知的 IANA 时区：${timeZone}`);
    this.name = 'InvalidTimeZoneError';
  }
}

const PART_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = PART_FORMATTERS.get(timeZone);
  if (cached !== undefined) return cached;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    throw new InvalidTimeZoneError(timeZone);
  }
  PART_FORMATTERS.set(timeZone, fmt);
  return fmt;
}

function numberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const raw = parts.find((p) => p.type === type)?.value ?? '';
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new InvalidTimeZoneError('(格式化结果缺少 ' + type + ')');
  return value;
}

/** UTC 瞬时 → 指定时区下的墙钟字段。 */
export function wallClockOf(utcMs: number, timeZone: string): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  return {
    year: numberPart(parts, 'year'),
    month: numberPart(parts, 'month'),
    day: numberPart(parts, 'day'),
    hour: numberPart(parts, 'hour'),
    minute: numberPart(parts, 'minute'),
    second: numberPart(parts, 'second'),
  };
}

/** 该时区在这个瞬时的 UTC 偏移（毫秒，东为正）。 */
export function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const w = wallClockOf(utcMs, timeZone);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // 秒以下的部分不参与偏移（所有 IANA 偏移都是整分钟），直接用整秒差即可。
  return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * 指定时区下的墙钟 → UTC 瞬时。
 *
 * ★ **用「切换前后各 24 小时的偏移」造候选，不用「两趟迭代」。**
 *   两趟迭代（先把墙钟当 UTC 查一次偏移、再用结果查第二次）看起来够用，实测**不够**：
 *   它在回拨日会收敛到哪一次出现，取决于时区偏移的**正负号**——
 *   · `America/New_York`（西区）回拨日 01:30 → 收敛到**第一次**（05:30Z）；
 *   · `Europe/Berlin`（东区）回拨日 02:30 → 收敛到**第二次**（01:30Z，而第一次是 00:30Z）。
 *   两者行为相反，而只测西区的话这个不一致**完全看不出来**（本轮变异测试 M8 就是这么
 *   被发现的：把整段换成 `Math.max` 之后 131 条用例照常全绿）。
 *
 *   ⇒ 改用标准做法：DST 切换一次最多改变一天内的偏移，所以 `naive ± 24h` 两处的偏移
 *   **必然把切换夹在中间**，用它们各造一个候选，再把候选格式化回该时区做验证：
 *   · **回拨（当地时刻出现两次）** → 两个候选都能还原 ⇒ 取 `min` = **第一次出现**，不重复；
 *   · **跳表（当地时刻不存在）** → 两个候选都还原不出来 ⇒ 取 `max` = 顺移到切换之后，不跳过；
 *   · 普通日 → 两个候选相同。
 */
export function wallClockToUtc(wall: WallClock, timeZone: string): number {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const DAY = 86_400_000;
  const before = naive - zoneOffsetMs(naive - DAY, timeZone);
  const after = naive - zoneOffsetMs(naive + DAY, timeZone);
  const candidates = before === after ? [before] : [before, after];
  const exact = candidates.filter((c) => sameWallClock(wallClockOf(c, timeZone), wall));
  return exact.length > 0 ? Math.min(...exact) : Math.max(...candidates);
}

function sameWallClock(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

/** 该时区下的星期（0=周日 … 6=周六，JS `Date#getDay` 口径）。 */
export function zonedWeekday(utcMs: number, timeZone: string): number {
  const w = wallClockOf(utcMs, timeZone);
  // Date.UTC + getUTCDay：全程 UTC 读取器，不碰本地时区。
  return new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
}

/**
 * 展示用格式化：`8-10 08:00`（月-日 时:分），**在规则自己的时区下**。
 * 界面上必须同时给出时区名（`AutomationRow.timezone`），否则这串数字是无意义的。
 *
 * ⚠️ 手拼而不是 `Intl.DateTimeFormat.format()`：后者对 `zh-CN` 会给出「8月10日 08:00」，
 * 而列表里要的是 P21-7 §3.1 那个紧凑写法。字段值仍全部来自 `wallClockOf`（带 timeZone），
 * 所以"不读本机时区"这条纪律没有被绕开。
 */
export function formatInZone(utcMs: number, timeZone: string): string {
  const w = wallClockOf(utcMs, timeZone);
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${String(w.month)}-${String(w.day)} ${two(w.hour)}:${two(w.minute)}`;
}

/**
 * 当前浏览器/运行环境的 IANA 时区。
 *
 * ⚠️ **全仓只有这一个函数允许读运行环境时区，而且只有一个合法调用点：新建规则时的默认值**
 * （P21-7 §3.2「仅新建规则继承当前用户时区」）。⛔ 求下一次触发时刻、格式化既有规则的时刻，
 * 一律**不得**调用它——那是 I-AUT-9 要防的漂移本身。
 */
export function resolveEnvironmentTimeZone(): string {
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return resolved === '' ? 'UTC' : resolved;
}
