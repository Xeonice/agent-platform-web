// 口令门锁定态（11 §3.1）：REST/WS 收到 401/未授权时置 locked，全局解锁门据此浮现。
// ⚠️ 纯内存、绝不 persist（安全红线，15 §3.5）：passcode 由后端 HttpOnly cookie 托管，前端不落任何明文/凭据。
// 未纳入 partializeAppState 白名单 → 天然不落盘。
import type { StateCreator } from 'zustand';

export interface AccessSlice {
  /** 是否处于锁定（需解锁）态。 */
  accessLocked: boolean;
  /** 锁定原因文案（来自后端错误信封 message，可空）。 */
  accessLockReason: string | null;
  /** 置为锁定（幂等）；reason 用于解锁门展示。 */
  lockAccess: (reason?: string | null) => void;
  /** 解锁成功后复位。 */
  clearAccessLock: () => void;
}

export const createAccessSlice: StateCreator<AccessSlice, [], [], AccessSlice> = (set) => ({
  accessLocked: false,
  accessLockReason: null,
  lockAccess: (reason = null): void => {
    set({ accessLocked: true, accessLockReason: reason });
  },
  clearAccessLock: (): void => {
    set({ accessLocked: false, accessLockReason: null });
  },
});
