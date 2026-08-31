// 简化预设调度 → cron 表达式（F21-7 §7.1）。
//
// ⚠️ **本文件产出的 cron 不参与前端的任何时刻计算。** 下一次触发时刻由
// `lib/automation/nextTriggerAt` 在规则时区下按墙钟直接求，不经过 cron ——
// cron 表达式本身**不携带时区**，把它当成中间表示会在 DST 边界上悄悄丢掉语义。
// 这里造它只为两件事：① 表单上给用户看一眼「这条规则等价于什么」；
// ② 提交前的一次形状校验（非法预设在到后端之前就拦下）。
//
// ⛔ MVP 不支持裸 cron 输入（P21-7 §3.2，自定义 cron 是 v1.2）——所以本文件只有
//    「预设 → cron」一个方向，**没有** cron 解析器。少一个解析器就少一整类解析歧义。
import type { AutomationScheduleConfig, ScheduleKind } from '@/types/automation';

export type ScheduleToCronResult = { ok: true; expression: string } | { ok: false; reason: string };

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

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
 * 预设 → cron。**非法输入返回 `{ok:false}`，不抛异常**（F21-7 §7.1 明确要求）：
 * 它的调用点是表单的每一次按键，抛异常等于让用户打字打到一半整块界面白掉。
 */
export function scheduleToCron(
  kind: ScheduleKind,
  config: AutomationScheduleConfig,
): ScheduleToCronResult {
  if (kind === 'hourly') {
    const minute = config.minute;
    if (minute === undefined) return { ok: false, reason: '请填写每小时触发的分钟。' };
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
      return { ok: false, reason: '分钟必须是 0–59 的整数。' };
    }
    return { ok: true, expression: `${String(minute)} * * * *` };
  }

  const at = parseHhMm(config.time);
  if (at === undefined) return { ok: false, reason: '请填写合法的触发时间（HH:MM）。' };

  if (kind === 'daily') {
    return { ok: true, expression: `${String(at.minute)} ${String(at.hour)} * * *` };
  }

  const days = config.days ?? [];
  if (days.length === 0) return { ok: false, reason: '请至少选择一天。' };
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return { ok: false, reason: '星期取值必须在 0（周日）–6（周六）之间。' };
  }
  // 去重 + 升序：用户点「一、三、一」得到的应当是稳定的同一条表达式。
  const uniq = [...new Set(days)].sort((a, b) => a - b);
  return {
    ok: true,
    expression: `${String(at.minute)} ${String(at.hour)} * * ${uniq.join(',')}`,
  };
}

/** 人话摘要：`每天 08:00` / `每小时 :00` / `每周一三五 08:00`（列表行的 `summaryText` 用）。 */
export function describeSchedule(kind: ScheduleKind, config: AutomationScheduleConfig): string {
  if (kind === 'hourly') {
    const minute = config.minute ?? 0;
    return `每小时 :${String(minute).padStart(2, '0')}`;
  }
  const time = config.time ?? '--:--';
  if (kind === 'daily') return `每天 ${time}`;
  const days = [...new Set(config.days ?? [])].sort((a, b) => a - b);
  if (days.length === 0) return `每周（未选星期）${time}`;
  // 「周一三五」而不是「周一、周三、周五」：列表行宽度有限，首字连写是产品页 §3.1 的写法。
  const label = days.map((d) => (WEEKDAY_NAMES[d] ?? '周?').slice(1)).join('');
  return `每周${label} ${time}`;
}
