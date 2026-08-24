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

export interface ReportUnauthorizedApi {
  /** 检查 REST 错误：若为 401 则置锁（供 mutation/query 的 onError 调用）。 */
  reportRestError: (error: unknown) => void;
  /** WS 握手未授权：直接置锁（无错误信封，reason 置空）。 */
  reportUnauthorized: () => void;
}

/** 把"未授权 → 置锁"的判定收敛为可复用回调（hook 层可 import service 的 ApiErrorException）。 */
export function useReportUnauthorized(): ReportUnauthorizedApi {
  const lockAccess = useAppStore((s) => s.lockAccess);

  const reportRestError = useCallback(
    (error: unknown): void => {
      if (error instanceof ApiErrorException && error.httpStatus === 401) {
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
