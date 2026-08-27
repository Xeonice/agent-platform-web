// 解锁流补测（11 §3.1）：401 上报置锁、WS 未授权置锁、提交成功清锁。
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAccessGate, useReportUnauthorized } from '@/hooks/access/useAccessGate';
import { useAppStore } from '@/stores';
import { ApiErrorException } from '@/services/api/apiError';

function makeWrapper(): ({ children }: { children: ReactNode }) => React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: 0 } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  useAppStore.getState().clearAccessLock();
});

describe('useReportUnauthorized', () => {
  it('REST 401 → 置锁，reason 取自后端信封 message', () => {
    const { result } = renderHook(() => useReportUnauthorized());
    act(() => {
      result.current.reportRestError(
        new ApiErrorException(
          { code: 'UNAUTHORIZED', message: '需要访问口令', retryable: false },
          401,
        ),
      );
    });
    expect(useAppStore.getState().accessLocked).toBe(true);
    expect(useAppStore.getState().accessLockReason).toBe('需要访问口令');
  });

  it('非 401 错误不置锁', () => {
    const { result } = renderHook(() => useReportUnauthorized());
    act(() => {
      result.current.reportRestError(
        new ApiErrorException(
          { code: 'PROVIDER_UNAVAILABLE', message: '不可用', retryable: false },
          503,
        ),
      );
      result.current.reportRestError(new Error('network'));
    });
    expect(useAppStore.getState().accessLocked).toBe(false);
  });

  it('WS 未授权 → 直接置锁（reason 为空）', () => {
    const { result } = renderHook(() => useReportUnauthorized());
    act(() => {
      result.current.reportUnauthorized();
    });
    expect(useAppStore.getState().accessLocked).toBe(true);
    expect(useAppStore.getState().accessLockReason).toBeNull();
  });
});

describe('useAccessGate', () => {
  it('locked/reason 映射 store', () => {
    act(() => {
      useAppStore.getState().lockAccess('会话过期');
    });
    const { result } = renderHook(() => useAccessGate(), { wrapper: makeWrapper() });
    expect(result.current.locked).toBe(true);
    expect(result.current.reason).toBe('会话过期');
  });

  it('提交口令成功（MSW 204）→ 清锁', async () => {
    act(() => {
      useAppStore.getState().lockAccess('需要访问口令');
    });
    const { result } = renderHook(() => useAccessGate(), { wrapper: makeWrapper() });
    expect(result.current.locked).toBe(true);

    act(() => {
      result.current.submit('correct-passcode');
    });

    await waitFor(() => {
      expect(useAppStore.getState().accessLocked).toBe(false);
    });
  });

  it('⭐ PASSCODE_LOCKED 是 **429**，也必须置锁 —— 判据是码不是状态', () => {
    // ⚠️ 只认 401 时，「被锁定」会漏出去掉进 `sandboxErrorCopy` 的「零副作用 ⇒ 改配置」
    //    那条路，在建任务对话框里弹出「无法用当前配置创建：口令错误次数过多…请调整配置后
    //    再试」——**改配置改不出来**（要等锁定过期），而且它压根不是任务配置的问题。
    //
    // MUTATION: 把判定改回只有 `httpStatus === 401` ⇒ 本条红。
    const { result } = renderHook(() => useReportUnauthorized());
    act(() => {
      result.current.reportRestError(
        new ApiErrorException(
          {
            code: 'PASSCODE_LOCKED',
            message: '口令错误次数过多，已暂时锁定；请 277 秒后重试',
            retryable: true,
          },
          429,
        ),
      );
    });
    expect(useAppStore.getState().accessLocked).toBe(true);
  });

  it('普通 429（限流，不是口令门）**不**置锁 —— 否则任何限流都会被误读成"要重新解锁"', () => {
    // ⚠️ 这条是上一条的对照：没有它，把判定放宽成"所有 429"也能全绿。
    const { result } = renderHook(() => useReportUnauthorized());
    act(() => {
      result.current.reportRestError(
        new ApiErrorException(
          { code: 'RATE_LIMITED', message: '请求过于频繁', retryable: true },
          429,
        ),
      );
    });
    expect(useAppStore.getState().accessLocked).toBe(false);
  });
});
