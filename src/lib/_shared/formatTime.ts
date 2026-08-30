// 相对时间的**唯一**实现点。
//
// 它此前住在 `lib/image/imageCardModel.ts` 里——那时只有镜像卡要说「解析于 3 天前」。
// F21-8 的初始化向导要说「上次检测：… （22 小时前）」，两处需要的是同一句话的同一种说法，
// 而 `lib/system/*` 去 import `lib/image/*` 只是把耦合藏进依赖图里（boundaries 允许
// lib→lib，所以它不会报错，也就永远不会有人回头拆）。⇒ 提到 `_shared`，image 侧保留
// re-export，调用点一个都不用改。

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * 相对过去时间：`刚刚` / `N 分钟前` / `N 小时前` / `N 天前`。
 * 无法解析（缺席 / 空串 / 非法日期）返回 `undefined` —— 调用方据此**整行不渲染**，
 * 而不是渲染「解析于 NaN 前」（F21-4 §7.1 ③）。时钟偏移导致的未来时刻归到「刚刚」。
 */
export function formatRelativePast(iso: string | undefined, now: number): string | undefined {
  if (iso === undefined || iso === '') return undefined;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return undefined;
  const elapsed = now - at;
  if (elapsed < MINUTE_MS) return '刚刚';
  if (elapsed < HOUR_MS) return `${String(Math.floor(elapsed / MINUTE_MS))} 分钟前`;
  if (elapsed < DAY_MS) return `${String(Math.floor(elapsed / HOUR_MS))} 小时前`;
  return `${String(Math.floor(elapsed / DAY_MS))} 天前`;
}
