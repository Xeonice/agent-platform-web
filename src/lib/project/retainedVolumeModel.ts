// 保留卷列表的视图模型（F21-6 §3.3「已保留卷」/ P20 §6 决策 2 / 10 §6「保留卷的打包口径」）。
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
    originText: dto.sandboxId === undefined ? '来源任务已归档' : `来源任务 ${dto.sandboxId}`,
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
