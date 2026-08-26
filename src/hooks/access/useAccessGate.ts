// 口令门 hook（副作用归此层，07 §3）：解锁提交 + 401/未授权上报，读写 access store。
import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { submitPasscode } from '@/services/api/access.service';
import { ApiErrorException } from '@/services/api/apiError';
import { useAppStore } from '@/stores';

export interface AccessGateApi {
  /** 是否处于锁定（需解锁）态。 */
  locked: boolean;
  /** 锁定原因（后端信封 message，可空）。 */
  reason: string | null;
  /** 解锁请求进行中。 */
  submitting: boolean;
  /** 解锁失败信息（口令错误/锁定等，来自后端信封）。 */
  errorMessage?: string;
  /** 提交口令解锁。 */
  submit: (passcode: string) => void;
}

/**
 * 解锁门编排：提交口令 → 成功后清锁 + invalidate 查询触发重试；
 * 终端 WS 自身在退避循环中，cookie 就位后下次重连即通过（无需在此显式重连）。
 */
export function useAccessGate(): AccessGateApi {
  const locked = useAppStore((s) => s.accessLocked);
  const reason = useAppStore((s) => s.accessLockReason);
  const clearAccessLock = useAppStore((s) => s.clearAccessLock);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: submitPasscode,
    onSuccess: () => {
      clearAccessLock();
      void queryClient.invalidateQueries(); // 重试原 REST 请求（查询）
    },
  });

  const submit = useCallback(
    (passcode: string): void => {
      mutation.mutate(passcode);
    },
    [mutation],
  );

  return {
    locked,
    reason,
    submitting: mutation.isPending,
    errorMessage: mutation.error?.message,
    submit,
  };
}

/**
 * 口令门自己的错误码（10 §6.8 的 `PASSCODE_*` 三行）。
 *
 * ⚠️ **判据是码，不是 HTTP 状态**：`PASSCODE_REQUIRED` / `PASSCODE_INVALID` 是 401，
 * 而 `PASSCODE_LOCKED` 是 **429** —— 只认 401 会把「被锁定」漏出去，让它掉进
 * `sandboxErrorCopy` 的「零副作用 ⇒ 就地改配置」那条路，弹出
 * 「无法用当前配置创建：口令错误次数过多…请调整配置后再试」。
 *
 * ⚠️ 那句话每一半都不对：**改配置改不出来**（要等锁定过期），而它出现在建任务对话框里
 * 也不对（这不是任务配置的问题）。根子是把「零副作用」当成了「改配置能解决」——
 * 前者是**平台没动过状态**（事实），后者是**出路**（推论），`PASSCODE_LOCKED` 只占前一半。
 */
const PASSCODE_CODES = new Set(['PASSCODE_REQUIRED', 'PASSCODE_INVALID', 'PASSCODE_LOCKED']);

export interface ReportUnauthorizedApi {
  /** 检查 REST 错误：口令门的拒绝（含 429 锁定）一律置锁（供 mutation/query 的 onError 调用）。 */
  reportRestError: (error: unknown) => void;
  /** WS 握手未授权：直接置锁（无错误信封，reason 置空）。 */
  reportUnauthorized: () => void;
}

/** 把"未授权 → 置锁"的判定收敛为可复用回调（hook 层可 import service 的 ApiErrorException）。 */
export function useReportUnauthorized(): ReportUnauthorizedApi {
  const lockAccess = useAppStore((s) => s.lockAccess);

  const reportRestError = useCallback(
    (error: unknown): void => {
      if (!(error instanceof ApiErrorException)) return;
      // 401 一律置锁（含没带信封的裸未授权）；其余状态只认口令门自己的码——
      // 否则任何 429 限流都会被误读成"要重新解锁"。
      if (error.httpStatus === 401 || PASSCODE_CODES.has(error.envelope.code)) {
        lockAccess(error.envelope.message);
      }
    },
    [lockAccess],
  );

  const reportUnauthorized = useCallback((): void => {
    lockAccess(null);
  }, [lockAccess]);

  return { reportRestError, reportUnauthorized };
}
