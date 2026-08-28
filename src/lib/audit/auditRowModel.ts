// AuditEventDto → 审计行视图模型（F21-5 §3A / 28 §5）。零副作用、零网络、可单测。
//
// 为什么必须在这里算干净：`AuditEventRow.view` 被 boundaries 禁止 import `lib/`
// （`from: 'view', allow: ['view','type','component']`），还被 `no-restricted-syntax`
// 禁掉了 `useEffect`——所以**时间怎么格式化、detail 怎么 stringify、耗时怎么人话化，
// view 一律不算**，只吃 `AuditRowModel`。
//
// ⚠️ 本文件的三条纪律，每一条都对应一个"看起来正常但错了"的写法：
//
//  ① **缺失值不产出字段，而不是产出 `'—'`**（F21-5 §8 末条）。`durationMs` 只有
//     `sandbox.provision.stage` 之类才有，多数事件没有；填 `'—'` 会让 view 失去
//     「这行到底有没有耗时」的判据，也让"后端补了字段"这件事在前端悄悄失效。
//     占位符是 **view 的决定**，不是 model 的。
//  ② **`detail` 为空 ⇒ 不产出 `detailText`**，view 据此**不给展开箭头**（§7.2）。
//     `{}` 与 `undefined` 一样算空——一个空对象展开来是 `{}`，点开一片空白比不给点更糟。
//  ③ **`errorCode` 独立成字段，绝不拼进 `summary`**。它与 10 §6.8 是同一个闭集，
//     拼进去就再也无法按码筛/按码统计，而界面上看着毫无异样。
import type { AuditEventDto, AuditRowModel } from '@/types/audit';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

/**
 * `actor` 的中文名。**这是"已知会被写出来的全集"，不是闭集**。
 *
 * 取值依据（后端 `audit.projector.ts` / `audit.recorder.ts` 实写的六个）：
 *   · `scheduler`      —— provision workflow / runtime-install（最高频的那个）
 *   · `reaper`         —— 状态流转透传
 *   · `user`           —— 建沙箱 / 建项目 / 凭证操作
 *   · `health-check`   —— 状态流转透传
 *   · `provider-event` —— 状态流转透传
 *   · `system`         —— 任务完成 / 凭证注入 / runtime 安装状态
 *
 * ⚠️ 后端的 `AuditActorSchema` 是 `z.string().min(1)`，列上**没有 CHECK 约束**——
 * 读那侧不能因为一个数据库允许的取值而报错或渲染空白。所以这里**必须保留 `?? actor` 兜底**，
 * ⛔ 绝不许改成穷举 switch / `Record<AuditActor, string>`：那样后端加一个 actor，
 * 前端就会在那一行上崩掉或显示 `undefined`，而这件事在替身里永远复现不了。
 * （`mcp` / `automation` 曾在这份名单里，后端一处都没写过——凭空的键同样是错的。）
 */
const ACTOR_LABELS: Readonly<Record<string, string>> = {
  scheduler: '调度器',
  reaper: '回收器',
  user: '用户',
  'health-check': '健康检查',
  'provider-event': 'Provider 事件',
  system: '系统',
};

/** 只有沙箱类事件才给时间线入口（P21-5 §10.2）。 */
export const SANDBOX_TIMELINE_LABEL = '查看该沙箱完整时间线';

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/**
 * 耗时人话化：`4231 → '4.2s'`、`850 → '850ms'`、`65_000 → '1m 5s'`。
 *
 * ⚠️ **`0` 要产出 `'0ms'`，不是不产出**：只有「这个事件没有耗时概念」才不产出。
 * 用 `if (!ms)` 判空会把一次真实的 0ms 记录抹成"没耗时"——这正是 ① 的反面。
 */
export function formatDurationMs(ms: number | undefined): string | undefined {
  if (ms === undefined || Number.isNaN(ms)) return undefined;
  if (ms < SECOND_MS) return `${String(Math.round(ms))}ms`;
  if (ms < MINUTE_MS) return `${(ms / SECOND_MS).toFixed(1)}s`;
  const minutes = Math.floor(ms / MINUTE_MS);
  const seconds = Math.round((ms % MINUTE_MS) / SECOND_MS);
  return `${String(minutes)}m ${String(seconds)}s`;
}

/**
 * 同日 `HH:mm:ss.SSS`；跨日前缀 `MM-DD`。**毫秒必须留着**——见 `AuditRowModel.timeText` 的注释。
 * 非法/缺席时间返回空串，由 view 决定怎么占位（同 ①）。
 */
export function formatAuditTime(iso: string, now: number): string {
  const at = new Date(iso);
  const ms = at.getTime();
  if (Number.isNaN(ms)) return '';
  const clock = `${pad(at.getHours(), 2)}:${pad(at.getMinutes(), 2)}:${pad(at.getSeconds(), 2)}.${pad(at.getMilliseconds(), 3)}`;
  const today = new Date(now);
  const sameDay =
    at.getFullYear() === today.getFullYear() &&
    at.getMonth() === today.getMonth() &&
    at.getDate() === today.getDate();
  return sameDay ? clock : `${pad(at.getMonth() + 1, 2)}-${pad(at.getDate(), 2)} ${clock}`;
}

/** `'system' → '系统'`；不在名单里的原样返回（开放集，不穷举）。 */
export function formatActor(actor: string): string {
  return ACTOR_LABELS[actor] ?? actor;
}

/** 已脱敏 detail 的展示串；**空对象与缺席都不产出**（② ）。 */
export function formatDetail(detail: Record<string, unknown> | undefined): string | undefined {
  if (detail === undefined) return undefined;
  if (Object.keys(detail).length === 0) return undefined;
  return JSON.stringify(detail, null, 2);
}

/** 一条 wire 事件 → 一行视图模型。`now` 由调用方给（可测、无隐藏时钟）。 */
export function auditRowModel(event: AuditEventDto, now: number): AuditRowModel {
  const durationText = formatDurationMs(event.durationMs);
  const detailText = formatDetail(event.detail);
  const model: AuditRowModel = {
    seq: event.seq,
    timeText: formatAuditTime(event.at, now),
    severity: event.severity,
    summary: event.summary,
    actorText: formatActor(event.actor),
  };
  if (durationText !== undefined) model.durationText = durationText;
  if (event.outcome !== undefined) model.outcome = event.outcome;
  if (event.errorCode !== undefined) model.errorCode = event.errorCode;
  if (detailText !== undefined) model.detailText = detailText;
  if (event.subjectType === 'sandbox' && event.subjectId !== undefined) {
    model.subjectLink = { subjectId: event.subjectId, label: SANDBOX_TIMELINE_LABEL };
  }
  return model;
}
