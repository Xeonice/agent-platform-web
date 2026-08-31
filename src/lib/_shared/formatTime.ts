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

/** `remainingWholeDays` 的结论：`expired` 与 `days===0` 是两件事，见下。 */
export interface RemainingDays {
  /** 到点了（`iso` 已在过去或正好是现在）。清理是后台任务，到点与真删之间有窗口。 */
  expired: boolean;
  /** **整数天向下取整**（P21-5 §6）。`expired` 为真时恒为 0。 */
  days: number;
}

/**
 * 「还剩几天」的**唯一**取整实现（P21-5 §6：整数天向下取整、不足 1 天单独说）。
 *
 * 它被两处消费：系统状态卡的「最早的成果还需 N 天清理」（`lib/system/resourceModel`）与
 * 项目菜单里每个保留卷自己的倒计时（`lib/project/retainedVolumeModel`）。两处的**句子**
 * 不同、**规则**必须相同——各写一份 `Math.floor(ms / DAY)` 的话，哪天产品把口径改成
 * 「向上取整」，改一处漏一处，两个界面会对同一个卷说出不同的天数。
 *
 * ⚠️ **`expired` 与 `days===0` 必须分开**：前者是「早就该清了，正在等后台任务」，后者是
 * 「今天之内会清」。合成一个会让已过期的卷显示「不足 1 天」，用户以为还来得及下载。
 * 无法解析（空串 / 非法日期）返回 `undefined`，调用方据此**不渲染**倒计时，而不是渲染 NaN。
 */
export function remainingWholeDays(iso: string, now: Date): RemainingDays | undefined {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return undefined;
  const remainMs = at - now.getTime();
  if (remainMs <= 0) return { expired: true, days: 0 };
  return { expired: false, days: Math.floor(remainMs / DAY_MS) };
}
