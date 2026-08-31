// DTO → 视图模型（F21-7 §6 状态矩阵落地）。view 不碰 DTO，也碰不到本文件（boundaries），
// 由 `hooks/automation/*` 转接 —— 与 `lib/project/retainedVolumeModel` 同一形状。
import { automationLifecycle, describeLifecycle } from '@/lib/automation/automationStatus';
import {
  describeWebhookStatus,
  formatDuration,
  formatRunOutcome,
} from '@/lib/automation/formatRunOutcome';
import { describeSchedule } from '@/lib/automation/scheduleToCron';
import { nextTriggerAt } from '@/lib/automation/nextTriggerAt';
import { formatInZone } from '@/lib/automation/timeZone';
import type { AutomationDto, AutomationRow, AutomationRunDto, RunRow } from '@/types/automation';

/**
 * @param environmentTimeZone 当前环境时区，**只用来判断要不要提示"这条规则用的不是你现在的时区"**。
 *   ⛔ 不参与任何时刻计算（03 §8.1 快照语义）。由 hook 注入，便于测试。
 */
export function automationRows(
  dtos: AutomationDto[],
  nowMs: number,
  environmentTimeZone: string,
): AutomationRow[] {
  return dtos.map((dto) => automationRow(dto, nowMs, environmentTimeZone));
}

export function automationRow(
  dto: AutomationDto,
  nowMs: number,
  environmentTimeZone: string,
): AutomationRow {
  const lifecycle = automationLifecycle({
    enabled: dto.enabled,
    degraded: dto.degraded,
    consecutiveFailures: dto.consecutiveFailures,
  });
  const presentation = describeLifecycle(lifecycle, dto.consecutiveFailures);
  const nextText = nextTriggerText(dto, nowMs, lifecycle);

  return {
    id: dto.id,
    name: dto.name,
    lifecycle,
    icon: presentation.icon,
    statusText: presentation.text,
    summaryText: `${dto.runtime} · ${describeSchedule(dto.scheduleKind, dto.scheduleConfig)}`,
    ...(nextText === undefined ? {} : { nextTriggerText: nextText }),
    timezone: dto.timezone,
    ...(dto.timezone === environmentTimeZone
      ? {}
      : {
          // ⚠️ 这一句是 P21-7 §3.2 时区快照语义在界面上的落点。没有它，用户换台机器打开
          //    会以为触发时刻漂了——漂的其实是他自己的系统时区，规则一动没动。
          timezoneNote: `按 ${dto.timezone} 的钟点触发（你现在是 ${environmentTimeZone}）`,
        }),
    needsAttention: presentation.needsAttention,
    consecutiveFailures: dto.consecutiveFailures,
  };
}

/**
 * 下次触发时间。
 *
 * ★ **后端给了 `nextTriggerAt` 就用后端的**（它才是调度器真正会用的那个时刻），
 *   只有后端没给（刚建、刚启用、契约暂缺）时才由前端按同一套规则算一个预览。
 *   ⛔ 反过来（前端算的盖过后端的）会让界面显示一个"我算出来的"时刻，
 *   与调度器实际触发的时刻不一致时无从发现。
 *
 * 禁用/自动禁用的规则**不显示下次触发时间** —— 它不会触发，给一个时刻是彻头彻尾的误导。
 */
function nextTriggerText(
  dto: AutomationDto,
  nowMs: number,
  lifecycle: AutomationRow['lifecycle'],
): string | undefined {
  if (lifecycle === 'off' || lifecycle === 'autoDisabled') return undefined;

  const fromServer = dto.nextTriggerAt;
  if (fromServer !== undefined) {
    const parsed = Date.parse(fromServer);
    if (!Number.isNaN(parsed)) return safeFormat(parsed, dto.timezone);
  }
  const computed = nextTriggerAt(dto.scheduleKind, dto.scheduleConfig, dto.timezone, nowMs, {
    degraded: lifecycle === 'degraded',
  });
  return computed === undefined ? undefined : safeFormat(computed, dto.timezone);
}

function safeFormat(utcMs: number, timeZone: string): string | undefined {
  try {
    return formatInZone(utcMs, timeZone);
  } catch {
    // 非法时区：宁可不显示，也不要用本机时区凑一个看起来正常的数字出来。
    return undefined;
  }
}

/** 运行历史行。`timeZone` 是**规则的**时区快照，不是浏览器的。 */
export function runRows(runs: AutomationRunDto[], timeZone: string): RunRow[] {
  return runs.map((run) => {
    // ⚠️ 读 `triggeredAt` 而不是 `startedAt`：后者在 `skipped`/`missed`/`pending` 上缺席，
    //    而那几类恰恰最需要时间（"什么时候错过的"）。用 startedAt 的话，这一格会渲染出
    //    `undefined` —— 不报错、只是那一行看起来坏了。
    const triggeredMs = Date.parse(run.triggeredAt);
    const startedAtText = Number.isNaN(triggeredMs)
      ? run.triggeredAt
      : (safeFormat(triggeredMs, timeZone) ?? run.triggeredAt);
    const duration = formatDuration(run.durationMs);
    const webhookNote = describeWebhookStatus(run.webhookStatus);
    return {
      id: run.id,
      outcome: formatRunOutcome(run),
      startedAtText,
      ...(duration === undefined ? {} : { durationText: duration }),
      ...(run.outputSummary === undefined ? {} : { outputSummary: run.outputSummary }),
      ...(run.sandboxId === undefined ? {} : { sandboxId: run.sandboxId }),
      ...(webhookNote === undefined ? {} : { webhookNote }),
    };
  });
}

/**
 * 把多页运行历史拼成一条列表。
 *
 * ★ **按 id 去重，这不是防御性编程，是这个分页口径必然需要的一步。**
 *   `GET /api/automations/:id/runs` 走的是 `page/pageSize` 偏移分页（10 §7.2 `Paginated<T>`），
 *   而运行历史是**从头部追加**的：用户翻到第 2 页时若中间新记了 3 条运行，
 *   第 2 页返回的头 3 条正是第 1 页尾部那 3 条 —— 界面上就是同一次运行出现两遍，
 *   **而且看起来完全正常**（时间、状态、耗时都对，只是重复了）。
 *   这与 `hooks/system/useAuditStream` 文件头 ① 记的是同一个坑，那条注释里点名的
 *   「此前 `automationKeys.runs` 用的是 offset 页码」说的就是这里。
 *
 *   ⚠️ 头部追加**只会造成重复、不会造成丢失**（丢失来自头部删除，运行历史没有这种操作），
 *   所以按 id 去重是完备的修法，不需要游标。⏳ 但更干净的解法仍是让后端换成 `before=<runId>`
 *   游标；已列进交付报告的后端待办。
 */
export function dedupeRunsById(pages: AutomationRunDto[][]): AutomationRunDto[] {
  const seen = new Set<string>();
  const out: AutomationRunDto[] = [];
  for (const page of pages) {
    for (const run of page) {
      if (seen.has(run.id)) continue;
      seen.add(run.id);
      out.push(run);
    }
  }
  return out;
}
