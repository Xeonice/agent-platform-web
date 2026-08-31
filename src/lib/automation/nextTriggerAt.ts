// 下一次触发时刻（F21-7 §7.1 / 03 §8.1 / P21-7 §9.1 #9、#31）。
//
// ★ **纯函数：`(kind, config, timezone, after)` → UTC 瞬时。** 同一组入参在任何机器上、
//   任何系统时区下都必须得到同一个结果。实现上的保证是「一处 `Date` 的本地读取器都不用」——
//   全部经 `lib/automation/timeZone`（显式 `timeZone` 参数）。
//
// ⚠️ **为什么不能图省事用 `new Date(y, m, d, h, min)`**：那个构造器按**本机**时区解释墙钟。
//   在开发者的机器上（本机时区 = 规则时区）它给出完全正确的结果，一上服务器就整体漂 8 小时，
//   而且没有任何报错——这正是 I-AUT-9 那条不变量存在的原因。
import { describeSchedule } from '@/lib/automation/scheduleToCron';
import { wallClockOf, wallClockToUtc, zonedWeekday } from '@/lib/automation/timeZone';
import type { AutomationScheduleConfig, ScheduleKind } from '@/types/automation';

/** 向前搜索的上限。每小时预设最多找 1 次、每天最多 1 次、每周最多 7 次，8 天足够有余。 */
const MAX_LOOKAHEAD_DAYS = 8;

function parseHhMm(time: string | undefined): { hour: number; minute: number } | undefined {
  if (time === undefined) return undefined;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (m === null) return undefined;
  const hour = Number.parseInt(m[1] ?? '', 10);
  const minute = Number.parseInt(m[2] ?? '', 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return { hour, minute };
}

/**
 * 求严格晚于 `afterUtcMs` 的下一次触发时刻（UTC 毫秒）。
 * 非法调度配置 / 非法时区 → `undefined`（调用点渲染「调度配置有误」，不是崩溃）。
 *
 * `degraded` 为真时按 03 §8.4「降频为每日一次」求解：**沿用原规则的时刻，只把频率压到一天一次**，
 * 原始的 `scheduleKind/scheduleConfig` 不改写（恢复时按原配置重算即可）。
 */
export function nextTriggerAt(
  kind: ScheduleKind,
  config: AutomationScheduleConfig,
  timeZone: string,
  afterUtcMs: number,
  options: { degraded?: boolean } = {},
): number | undefined {
  try {
    return computeNext(kind, config, timeZone, afterUtcMs, options.degraded === true);
  } catch {
    // 非法 IANA 时区（后端漂了 / 手工改库）。⛔ 不回落到本机时区——那会给出一个
    // 看起来正常的错误时刻，比空着危险得多。
    return undefined;
  }
}

function computeNext(
  kind: ScheduleKind,
  config: AutomationScheduleConfig,
  timeZone: string,
  afterUtcMs: number,
  degraded: boolean,
): number | undefined {
  if (kind === 'hourly' && !degraded) {
    const minute = config.minute;
    if (minute === undefined || !Number.isInteger(minute) || minute < 0 || minute > 59) {
      return undefined;
    }
    // 每小时：从"当前小时的第 minute 分"起，逐小时向后找第一个严格晚于 after 的。
    // ⚠️ 仍走墙钟 → UTC 的转换而不是 `after + 3600_000`：DST 切换那一小时，
    //    「每小时 :00」在当地是跳过/重复一个整点的，直接加毫秒会与当地钟面对不上。
    for (let i = 0; i <= 24 * MAX_LOOKAHEAD_DAYS; i += 1) {
      const probe = wallClockOf(afterUtcMs + i * 3_600_000, timeZone);
      const candidate = wallClockToUtc({ ...probe, minute, second: 0 }, timeZone);
      if (candidate > afterUtcMs) return candidate;
    }
    return undefined;
  }

  // daily / weekly / 降频态：都是"某个墙钟时刻 + 一组允许的日子"。
  const at = parseHhMm(config.time);
  if (at === undefined) {
    // 降频态下原规则若是 hourly，没有 `time` 可沿用 ⇒ 取 :minute 所在的每天该分钟。
    if (degraded && kind === 'hourly' && config.minute !== undefined) {
      return dailyAt({ hour: 0, minute: config.minute }, timeZone, afterUtcMs, undefined);
    }
    return undefined;
  }

  // ★ 降频 = 每日一次：**忽略 weekly 的 days 限制**，但保留原时刻（03 §8.4）。
  const allowedDays = degraded || kind === 'daily' ? undefined : normalizeDays(config.days);
  // weekly 且一天都没选 ⇒ 这条规则永远不会触发，返回 undefined 让界面显示"调度配置有误"。
  if (allowedDays?.length === 0) return undefined;
  return dailyAt(at, timeZone, afterUtcMs, allowedDays);
}

function normalizeDays(days: number[] | undefined): number[] | undefined {
  if (days === undefined) return [];
  const uniq = [...new Set(days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return uniq;
}

function dailyAt(
  at: { hour: number; minute: number },
  timeZone: string,
  afterUtcMs: number,
  allowedDays: number[] | undefined,
): number | undefined {
  const base = wallClockOf(afterUtcMs, timeZone);
  for (let offset = 0; offset <= MAX_LOOKAHEAD_DAYS; offset += 1) {
    // 用 UTC 日历做"日 +1"，再把结果当作**该时区的墙钟**回代 —— 全程不碰本地时区。
    const shifted = new Date(Date.UTC(base.year, base.month - 1, base.day + offset));
    const wall = {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: at.hour,
      minute: at.minute,
      second: 0,
    };
    const candidate = wallClockToUtc(wall, timeZone);
    if (candidate <= afterUtcMs) continue;
    if (allowedDays !== undefined && !allowedDays.includes(zonedWeekday(candidate, timeZone))) {
      continue;
    }
    return candidate;
  }
  return undefined;
}

/** 表单上的一句预览：`每天 08:00（Asia/Shanghai）`。时区**永远跟着一起显示**。 */
export function describeScheduleWithZone(
  kind: ScheduleKind,
  config: AutomationScheduleConfig,
  timeZone: string,
): string {
  return `${describeSchedule(kind, config)}（${timeZone}）`;
}
