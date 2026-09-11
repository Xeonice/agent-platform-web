// 失败项目恢复补测（P0-1/P0-2）：retry 失败必回退到 failed（不停在 cloning）+ 可见错误；convert 成功回调。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { useProjectRecovery } from '@/hooks/project/useProjectRecovery';
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
    // ⛔ 后端 message 不上屏：未知码走通用兜底（见 `lib/_shared/errorCopy`）。
    expect(result.current.actionError).toBe('操作失败，请稍后重试。');
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

    /**
     * ★ **`INVALID_STATE` 的文案由「调用点」决定**：同一个 409，[重试克隆] 和
     *   [改为空项目] 该说的话不一样，而"这是哪个动作"只有调用点知道。
     *   ⛔ 不许合并成一句「当前状态不允许该操作」——那句话解释不了任何事，也没给出路。
     */
    await waitFor(() => {
      expect(result.current.actionError).toContain('改不成空项目');
    });
    // ⛔ 后端原文不上屏。
    expect(result.current.actionError).not.toContain('仅失败态');
  });

  it('⭐ retry 与 convert 的 INVALID_STATE 是两句不同的话（合并回一句这条就红）', async () => {
    useAppStore.getState().setCloneProgress('p1', { phase: 'failed', errorCode: 'TIMEOUT' });
    server.use(
      http.post(`${API_BASE}/api/projects/:id/retry-clone`, () =>
        HttpResponse.json(
          {
            code: 'INVALID_STATE',
            message: 'retry-clone is only allowed on a failed project',
            retryable: false,
          },
          { status: 409 },
        ),
      ),
    );
    const { result } = renderHook(
      () => useProjectRecovery({ projectId: 'p1', errorCode: 'TIMEOUT' }),
      { wrapper: makeWrapper() },
    );
    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(result.current.actionError).toContain('重试克隆用不上了');
    });
    expect(result.current.actionError).not.toContain('retry-clone');
  });

  it('guidance 由 errorCode 派生（DISK_INSUFFICIENT：清完盘可以在这个项目上重试克隆）', () => {
    const { result } = renderHook(
      () => useProjectRecovery({ projectId: 'p1', errorCode: 'DISK_INSUFFICIENT' }),
      { wrapper: makeWrapper() },
    );
    // ⚠️ 由 false 改为 true：藏掉这个按钮，用户腾出空间之后没有路回到这个项目上，
    //    而旧文案给的"重新创建"会多造一个项目（重试克隆 ≠ 重新创建）。
    expect(result.current.guidance.canRetry).toBe(true);
    expect(result.current.guidance.message).not.toContain('重新创建');
  });
});
