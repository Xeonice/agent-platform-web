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
});
