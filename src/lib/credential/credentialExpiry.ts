// 凭证有效期派生（F21-3 §5/§9，可单测）：≥7 天 ok / <7 天 warning / ≤0 expired / 无 expiresAt（API key）noExpiry。
// 「剩 X 天」整数天向下取整——>0 显示「剩 N 天」，不足 1 天显示「剩 <1 天」，≤0 显示「已过期」（P21-3 §9）。
// 与全局横幅同源：横幅「剩余 < 7 天」用同一阈值（product 20 §5.3）。零副作用、零网络。

import type { ExpiryState } from '@/types/runtimeCredential';

export type { ExpiryState };

const DAY_MS = 24 * 60 * 60 * 1000;
/** <7 天预警阈值（product 20 §5.3「剩余 < 7 天」/ F21-3 §9「≥7 天绿勾；<7 天 ⚠️」）。 */
export const EXPIRY_WARNING_DAYS = 7;

/** 有效期状态：expiresAt 为空（API key 常无）→ noExpiry；否则按剩余天数判档。 */
export function expiryState(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): ExpiryState {
  if (expiresAt === null || expiresAt === undefined || expiresAt === '') return 'noExpiry';
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return 'noExpiry';
  const remaining = end - now;
  if (remaining <= 0) return 'expired';
  // ≥7 天绿勾；<7 天预警（F21-3 §9 acceptance：等号归 ok）。
  return remaining >= EXPIRY_WARNING_DAYS * DAY_MS ? 'ok' : 'warning';
}

/** 「剩 X 天」展示（向下取整；不足 1 天「剩 <1 天」；≤0「已过期」；无有效期返回 undefined 不渲染倒计时）。 */
export function formatDaysLeft(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): string | undefined {
  if (expiresAt === null || expiresAt === undefined || expiresAt === '') return undefined;
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return undefined;
  const remaining = end - now;
  if (remaining <= 0) return '已过期';
  const days = Math.floor(remaining / DAY_MS);
  return days < 1 ? '剩 <1 天' : `剩 ${String(days)} 天`;
}
