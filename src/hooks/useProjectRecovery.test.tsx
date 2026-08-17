// 失败项目恢复补测（P0-1/P0-2）：retry 失败必回退到 failed（不停在 cloning）+ 可见错误；convert 成功回调。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { useProjectRecovery } from '@/hooks/useProjectRecovery';
import { useAppStore } from '@/stores';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

function makeWrapper(): ({ children }: { children: ReactNode }) => React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  useAppStore.getState().clearCloneProgress('p1');
});

describe('useProjectRecovery', () => {
  it('retry 失败 → 回退到 failed（保留 errorCode）+ 展示可见错误，不停在 cloning（P0-2）', async () => {
    // 起点：失败态
    useAppStore.getState().setCloneProgress('p1', {
      phase: 'failed',
      errorCode: 'CLONE_FAILED_NETWORK',
    });
    // retry-clone 服务端 500
    server.use(
      http.post(`${API_BASE}/api/projects/:id/retry-clone`, () =>
        HttpResponse.json(
          { code: 'CLONE_FAILED', message: '克隆服务暂时不可用', retryable: true },
          { status: 500 },
        ),
      ),
    );

    const { result } = renderHook(
      () => useProjectRecovery({ projectId: 'p1', errorCode: 'CLONE_FAILED_NETWORK' }),
      { wrapper: makeWrapper() },
    );

    act(() => {
      result.current.retry();
    });
    // 乐观：先置 cloning
    expect(useAppStore.getState().projectClones['p1']?.phase).toBe('cloning');

    // 失败后回退 failed + 保留 errorCode + actionError 可见
    await waitFor(() => {
      expect(useAppStore.getState().projectClones['p1']?.phase).toBe('failed');
    });
    expect(useAppStore.getState().projectClones['p1']?.errorCode).toBe('CLONE_FAILED_NETWORK');
    expect(result.current.actionError).toBe('克隆服务暂时不可用');
  });

  it('convert-to-empty 成功 → 清 clone 态 + onConverted(projectId)', async () => {
    useAppStore.getState().setCloneProgress('p1', { phase: 'failed', errorCode: 'TIMEOUT' });
    const onConverted = vi.fn();

    const { result } = renderHook(
      () => useProjectRecovery({ projectId: 'p1', errorCode: 'TIMEOUT', onConverted }),
      { wrapper: makeWrapper() },
    );

    act(() => {
      result.current.convertToEmpty();
    });

    await waitFor(() => {
      expect(onConverted).toHaveBeenCalledWith('p1');
    });
    expect(useAppStore.getState().projectClones['p1']).toBeUndefined();
  });

  it('convert-to-empty 409（非 failed 态）→ 可见错误，不静默卡死', async () => {
    useAppStore.getState().setCloneProgress('p1', { phase: 'failed', errorCode: 'TIMEOUT' });
    server.use(
      http.post(`${API_BASE}/api/projects/:id/convert-to-empty`, () =>
        HttpResponse.json(
          { code: 'INVALID_STATE', message: '仅失败态可转为空项目', retryable: false },
          { status: 409 },
        ),
      ),
    );

    const { result } = renderHook(
      () => useProjectRecovery({ projectId: 'p1', errorCode: 'TIMEOUT' }),
      { wrapper: makeWrapper() },
    );

    act(() => {
      result.current.convertToEmpty();
    });

    await waitFor(() => {
      expect(result.current.actionError).toBe('仅失败态可转为空项目');
    });
  });

  it('guidance 由 errorCode 派生（DISK_INSUFFICIENT 不可重试）', () => {
    const { result } = renderHook(
      () => useProjectRecovery({ projectId: 'p1', errorCode: 'DISK_INSUFFICIENT' }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.guidance.canRetry).toBe(false);
  });
});
