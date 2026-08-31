// 资源池卡片的视图模型（F21-5 §6 / P21-5 §5 / 审计 P1-9）。
//
// ⚠️ **本文件不重算每个维度的三档，这是刻意的。**
// 后端 `system-resources.service.ts` 已经给出每个维度的 `level`，而且 CPU/RAM 与磁盘用的
// 是**两套不同的阈值**（80/95 与 75/90，分别对齐 P21-5 §5 的两行）。F21-5 §6 那句
// 「三个维度使用率均 <80%」是**页面文档的简写**，照它在前端再算一遍会产生一个具体的谎：
// 磁盘 78% 时后端说 ⚠️、前端说 ✅，同一张卡上的图标与颜色互相打架，而两边各自都"按文档
// 实现了"。⇒ 每维度的档次一律取后端的 `level`。
//
// ⚠️ **前端真正要算、也只能在前端算的是「整体等级」——取最差维度而非平均**（审计 P1-9）。
// `{cpu:10%, ram:20%, disk:98%}` 必须是 `critical`：平均会把它算成健康，而那恰恰是最该
// 拦住新建 Task 的时刻。后端没有这个字段（它按维度出结论，不下整体判断），所以这一步
// 没有第二个来源。
import { remainingWholeDays } from '@/lib/_shared/formatTime';
import type {
  ResourceGaugeModel,
  ResourceLevel,
  ResourcePoolCardModel,
  RetainedVolumeModel,
  SystemResourcesDto,
} from '@/types/system';

/** 由好到坏。**顺序即严重度**，`overallResourceLevel` 靠它取最差。 */
const LEVEL_ORDER: readonly ResourceLevel[] = ['ok', 'warn', 'critical'];

const OVERALL_TEXT: Readonly<Record<ResourceLevel, string>> = {
  ok: '资源充足',
  // 三档各自一句，且**这一句要说出下一步动作**——"资源警告"四个字用户读完不知道要干嘛。
  warn: '资源紧张，建议停止部分 Task',
  critical: '资源耗尽，无法创建新 Task',
};

/**
 * **取最差维度**，不是平均，也不是"多数"。
 *
 * ⚠️ 空数组回 `'ok'` 是唯一合理的兜底（"没有维度可判" ≠ "有维度坏了"），
 * 但生产上永远走不到：三个维度在契约里都是必填的。
 */
export function overallResourceLevel(levels: readonly ResourceLevel[]): ResourceLevel {
  let worst = 0;
  for (const level of levels) {
    const rank = LEVEL_ORDER.indexOf(level);
    if (rank > worst) worst = rank;
  }
  return LEVEL_ORDER[worst] ?? 'ok';
}

const KB = 1024;
const UNITS: readonly string[] = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** 选一个让**总量**读起来舒服的单位，已用量跟着它走（`'150 / 200 GB'` 两个数同单位才可比）。 */
function unitFor(bytes: number): { divisor: number; unit: string } {
  let exp = 0;
  let value = Math.abs(bytes);
  while (value >= KB && exp < UNITS.length - 1) {
    value /= KB;
    exp += 1;
  }
  return { divisor: KB ** exp, unit: UNITS[exp] ?? 'B' };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** `'150 / 200 GB'`。⚠️ 分母是**总容量**，与 15% 预留无关（P21-8 §7：预留只影响调度上限）。 */
export function formatAmount(usedBytes: number, totalBytes: number): string {
  const { divisor, unit } = unitFor(totalBytes);
  return `${String(round1(usedBytes / divisor))} / ${String(round1(totalBytes / divisor))} ${unit}`;
}

/** `'45 GB'`。 */
export function formatBytes(bytes: number): string {
  const { divisor, unit } = unitFor(bytes);
  return `${String(round1(bytes / divisor))} ${unit}`;
}

/**
 * 保留卷倒计时（P21-5 §6）：**整数天向下取整**，不足 1 天说「不足 1 天」。
 *
 * ⚠️ 已过期（`expiresAt` 在过去）说「即将清理」而不是负数天——FIFO 清理是后台任务，
 * 到点与真正删掉之间有窗口，报「还需 -1 天」会让用户以为界面坏了。
 *
 * ⚠️ **取整规则本身不在这里**，在 `lib/_shared/formatTime` 的 `remainingWholeDays`：
 * 项目菜单里每个保留卷各自的倒计时（`lib/project/retainedVolumeModel`）说的是另一句话，
 * 但必须是同一个规则。本函数只负责把结论包成这张卡要的那句话。
 */
export function formatRetainedCountdown(expiresAtIso: string, now: Date): string | undefined {
  const remaining = remainingWholeDays(expiresAtIso, now);
  if (remaining === undefined) return undefined;
  if (remaining.expired) return '最早的成果即将清理';
  return remaining.days < 1
    ? '最早的成果不足 1 天后清理'
    : `最早的成果还需 ${String(remaining.days)} 天清理`;
}

function retainedModel(dto: SystemResourcesDto, now: Date): RetainedVolumeModel {
  const r = dto.retainedVolumes;
  const countdown =
    r.oldestExpiresAt === undefined ? undefined : formatRetainedCountdown(r.oldestExpiresAt, now);
  return {
    count: r.count,
    level: r.level,
    sizeText: formatBytes(r.totalBytes),
    shareText: `占 DATA_ROOT 的 ${String(r.percentOfDisk)}%`,
    ...(countdown === undefined ? {} : { countdownText: countdown }),
    truncated: r.truncated,
  };
}

export function resourcePoolModel(dto: SystemResourcesDto, now: Date): ResourcePoolCardModel {
  const gauges: ResourceGaugeModel[] = [
    {
      id: 'cpu',
      label: 'CPU',
      level: dto.cpu.level,
      usedPercent: dto.cpu.usedPercent,
      amountText: `${String(round1(dto.cpu.loadAvg1m))} / ${String(dto.cpu.cores)} 核`,
    },
    {
      id: 'ram',
      label: '内存',
      level: dto.ram.level,
      usedPercent: dto.ram.usedPercent,
      amountText: formatAmount(dto.ram.usedBytes, dto.ram.totalBytes),
    },
    {
      id: 'disk',
      label: `磁盘（${dto.disk.path}）`,
      level: dto.disk.level,
      usedPercent: dto.disk.usedPercent,
      amountText: formatAmount(dto.disk.usedBytes, dto.disk.totalBytes),
    },
  ];

  const overallLevel = overallResourceLevel(gauges.map((g) => g.level));

  return {
    gauges,
    overallLevel,
    overallText: OVERALL_TEXT[overallLevel],
    activeTasks: dto.activeTasks,
    reservedPercent: dto.disk.reservedPercent,
    retained: retainedModel(dto, now),
    // ⚠️ [清理保留卷] 挂在**磁盘**维度上，不是挂在整体等级上：CPU 95% 时给一个
    //    「清理保留卷」的按钮毫无意义（清盘不降 CPU），而磁盘满时"停止部分 Task"
    //    同样没用（停 Task 不释放保留卷）。两条出路各归各的维度。
    showCleanupRetained: dto.disk.level !== 'ok' || dto.retainedVolumes.level !== 'ok',
  };
}
