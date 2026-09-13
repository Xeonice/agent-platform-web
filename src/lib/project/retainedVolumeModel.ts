// 「保留下来的成果」列表的视图模型（F21-6 §3.3 / P20 §6 决策 2 / 10 §6「保留卷的打包口径」）。
// ⚠️ 屏上一律叫「保留下来的成果」，`volume` / 「卷」是内部词，⛔ 不上屏。
//
// 纯函数：DTO[] + 一个注入的"现在" → 可直接渲染的行。**所有文案在这里定，view 只摆位置**
// ——倒计时要一个可注入的时钟（否则测不了边界），而 view 层连 `new Date()` 都不该有。
import { remainingWholeDays } from '@/lib/_shared/formatTime';
import type {
  RetainedVolumeDto,
  RetainedVolumeRow,
  RetainedVolumeSource,
  RetainedVolumeTotals,
} from '@/types/retainedVolume';

const KB = 1024;
const UNITS: readonly string[] = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/**
 * 字节 → 人话。`1073741824 → '1.0 GB'`、`14680064 → '14 MB'`、`512 → '512 B'`。
 * 小数位随量级走：<10 给一位（1.0 GB 比 1 GB 更像一个测出来的数），≥10 不给（14 MB）。
 */
export function formatVolumeBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= KB && unit < UNITS.length - 1) {
    value /= KB;
    unit += 1;
  }
  const shown = unit === 0 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 0 : 1);
  return `${shown} ${UNITS[unit] ?? 'B'}`;
}

const SOURCE_LABEL: Readonly<Record<RetainedVolumeSource, string>> = {
  'manual-destroy': '销毁任务时保留',
  'automation-artifact': '自动化产物',
};

/**
 * 来源任务这一行。
 *
 * ★ **`sandboxId` 缺席只说明「关联不上」，⛔ 不等于「已归档」。**
 *   旧文案是「来源任务已归档」—— 那是把"不知道"说成了一个具体状态。缺一个 id 的原因
 *   可能是任务被删了、可能是后端这条记录本来就没记上、也可能是那次登记发生在
 *   `sandbox_id` 这一列存在之前。归档只是其中一种，而且这个平台**根本没有归档功能**
 *   （F21-6 §10 D 已裁决不做）—— 界面在指认一个不存在的状态。
 *
 * ⚠️ 同时**不再把整串裸 UUID 当句子上屏**：`来源任务 7f3a-4b1c-…-9e02` 占满一行，
 *   而用户既搜不了也点不了。这里只留前 8 位供人肉对号，完整 id 仍在 `sandboxId` 字段里
 *   （[打开任务] 这类入口要用），由 view 挂到 `title` 上给需要的人。
 */
const SHORT_ID_CHARS = 8;

function originText(sandboxId: string | undefined): string {
  if (sandboxId === undefined) return '关联不到来源任务（可能已被删除）';
  const short =
    sandboxId.length > SHORT_ID_CHARS ? `${sandboxId.slice(0, SHORT_ID_CHARS)}…` : sandboxId;
  return `来自任务 ${short}`;
}

/**
 * 单条 DTO → 行。`now` 由 hook 注入（15：时钟不进 lib，否则倒计时的边界值没法测）。
 */
export function retainedVolumeRow(dto: RetainedVolumeDto, now: Date): RetainedVolumeRow {
  const remaining = remainingWholeDays(dto.retainUntil, now);
  const countdownText =
    remaining === undefined
      ? undefined
      : remaining.expired
        ? '即将清理'
        : remaining.days < 1
          ? '不足 1 天'
          : `还需 ${String(remaining.days)} 天`;

  return {
    id: dto.id,
    ...(dto.sandboxId === undefined ? {} : { sandboxId: dto.sandboxId }),
    originText: originText(dto.sandboxId),
    sourceText: SOURCE_LABEL[dto.source],
    retainedAtText: formatStamp(dto.retainedAt),
    diskText: formatVolumeBytes(dto.diskBytes),
    downloadText: formatVolumeBytes(dto.downloadBytes),
    ...(countdownText === undefined ? {} : { countdownText }),
    urgent: remaining !== undefined && (remaining.expired || remaining.days < 1),
  };
}

/**
 * 列表 → 行，**按 `retainUntil` 升序**：最先被 VolumeReaper 清掉的排在最上面。
 *
 * 为什么不是按体积或时间倒序：这个界面回答的两个问题里，"哪个快没了、要不要现在下载"
 * 是有截止期的那一个，另一个（"删哪个能腾出盘"）用户扫一眼体积列就行。清理是 FIFO
 * （P21-5 §6），把 FIFO 的队头放在视线起点，界面顺序就等于真实的消失顺序。
 *
 * ⚠️ `retainUntil` 解析不出来的排到最后：它们本来就没有倒计时可言，混在中间会打乱队形。
 */
export function retainedVolumeRows(
  dtos: readonly RetainedVolumeDto[],
  now: Date,
): RetainedVolumeRow[] {
  return [...dtos]
    .sort((a, b) => sortKey(a.retainUntil) - sortKey(b.retainUntil))
    .map((dto) => retainedVolumeRow(dto, now));
}

function sortKey(iso: string): number {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
}

/**
 * 合计：面板标题上的「N 个 · 共占用 X · 全部下载 Y」。
 * 两个总量同样都给——只报下载总量会让人以为"全清掉才腾出 14 MB"，那正是不清理的理由。
 */
export function retainedVolumeTotals(dtos: readonly RetainedVolumeDto[]): RetainedVolumeTotals {
  return {
    count: dtos.length,
    diskText: formatVolumeBytes(dtos.reduce((sum, d) => sum + d.diskBytes, 0)),
    downloadText: formatVolumeBytes(dtos.reduce((sum, d) => sum + d.downloadBytes, 0)),
  };
}

/** ISO → 本地可读；解析不出来原样吐回（不吞掉后端给的字符串）。 */
function formatStamp(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}
