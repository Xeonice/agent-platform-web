// 已保留卷 hook：Query + 删除 mutation + 错误人话（MSW 驱动，F21-6 §3.3）。
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import {
  useRetainedVolumes,
  retainedVolumeKeys,
  describeRetainedVolumeError,
} from '@/hooks/project/useRetainedVolumes';
import { ApiErrorException } from '@/services/api/apiError';

const BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

function makeWrapper(): ({ children }: { children: ReactNode }) => React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useRetainedVolumes · 列表', () => {
  it('拿到行与合计，两个大小分别成文案', async () => {
    const { result } = renderHook(() => useRetainedVolumes('proj-demo'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.rows.length).toBe(2);
    expect(result.current.totals.count).toBe(2);
    // MSW 替身刻意把两个数造成一个数量级之外的差（10 §6 实测 70 倍）。
    expect(result.current.rows[0]?.diskText).not.toBe(result.current.rows[0]?.downloadText);
  });

  it('⭐ projectId 为 null（没选中项目）→ 不发请求、不报错、给空列表', async () => {
    const spy = vi.fn();
    server.use(
      http.get(`${BASE}/api/retained-volumes`, () => {
        spy();
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHook(() => useRetainedVolumes(null), { wrapper: makeWrapper() });
    await act(async () => {
      await Promise.resolve();
    });
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.rows).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('⭐ 每个项目一把 key：切项目不会读到上一个项目的缓存', () => {
    expect(retainedVolumeKeys.list('a')).not.toEqual(retainedVolumeKeys.list('b'));
    expect(retainedVolumeKeys.list('a')).toEqual(['retained-volumes', 'list', 'a']);
  });

  it('列表失败 → loadErrorMessage 有人话，rows 保持空（不冒充空态由 view 分支）', async () => {
    server.use(
      http.get(`${BASE}/api/retained-volumes`, () =>
        HttpResponse.json(
          { code: 'INTERNAL', message: '读取保留卷失败', retryable: true },
          { status: 500 },
        ),
      ),
    );
    const { result } = renderHook(() => useRetainedVolumes('proj-demo'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.loadErrorMessage).toBe('读取保留卷失败');
    });
    expect(result.current.rows).toEqual([]);
  });
});

describe('useRetainedVolumes · 删除', () => {
  it('删除成功 → 列表被重新拉取（DELETE 打到 /:id）', async () => {
    let deletedId: string | undefined;
    let listCalls = 0;
    server.use(
      http.get(`${BASE}/api/retained-volumes`, () => {
        listCalls += 1;
        return HttpResponse.json([]);
      }),
      http.delete(`${BASE}/api/retained-volumes/:id`, ({ params }) => {
        deletedId = String(params['id']);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => useRetainedVolumes('proj-demo'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(listCalls).toBe(1);
    });

    act(() => {
      result.current.remove('rv-9');
    });
    await waitFor(() => {
      expect(deletedId).toBe('rv-9');
    });
    // ⭐ 成功后必须 invalidate：否则删掉的那条还在界面上。
    await waitFor(() => {
      expect(listCalls).toBe(2);
    });
  });

  it('⭐ 删除失败（404 = 已被自动清理）也 invalidate 列表', async () => {
    let listCalls = 0;
    server.use(
      http.get(`${BASE}/api/retained-volumes`, () => {
        listCalls += 1;
        return HttpResponse.json([]);
      }),
      http.delete(
        `${BASE}/api/retained-volumes/:id`,
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    const { result } = renderHook(() => useRetainedVolumes('proj-demo'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(listCalls).toBe(1);
    });

    act(() => {
      result.current.remove('rv-gone');
    });
    await waitFor(() => {
      expect(result.current.actionErrorMessage).toBe(
        '这个保留卷已经不存在了（可能刚被自动清理）。',
      );
    });
    // 那条记录真的没了 —— 列表必须跟着更新，否则用户会对着一条不存在的记录反复点删除。
    await waitFor(() => {
      expect(listCalls).toBe(2);
    });
    // 删完（无论成败）不再卡在"删除中"。
    await waitFor(() => {
      expect(result.current.deletingId).toBeNull();
    });
  });

  it('删除进行中 → deletingId 指向那一条（逐行禁用，不是整面板禁用）', async () => {
    let resolveDelete: (() => void) | undefined;
    server.use(
      http.delete(`${BASE}/api/retained-volumes/:id`, async () => {
        await new Promise<void>((resolve) => {
          resolveDelete = resolve;
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => useRetainedVolumes('proj-demo'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.remove('rv-1');
    });
    await waitFor(() => {
      expect(result.current.deletingId).toBe('rv-1');
    });
    act(() => {
      resolveDelete?.();
    });
    await waitFor(() => {
      expect(result.current.deletingId).toBeNull();
    });
  });
});

describe('describeRetainedVolumeError', () => {
  it('无错误 → undefined', () => {
    expect(describeRetainedVolumeError(null)).toBeUndefined();
    expect(describeRetainedVolumeError(undefined)).toBeUndefined();
  });

  it('404 有专属人话（这是竞态，不是"操作失败"）', () => {
    const err = new ApiErrorException(
      { code: 'NOT_FOUND', message: 'Not Found', retryable: false },
      404,
    );
    expect(describeRetainedVolumeError(err)).toBe('这个保留卷已经不存在了（可能刚被自动清理）。');
  });

  it('其余 4xx/5xx 用后端信封原话', () => {
    const err = new ApiErrorException(
      { code: 'FORBIDDEN', message: '没有权限删除该保留卷', retryable: false },
      403,
    );
    expect(describeRetainedVolumeError(err)).toBe('没有权限删除该保留卷');
  });

  it('信封 message 为空 → 兜底文案（不给用户一个空红字）', () => {
    const err = new ApiErrorException({ code: 'INTERNAL', message: '', retryable: true }, 500);
    expect(describeRetainedVolumeError(err)).toBe('操作失败，请稍后重试。');
  });

  it('非 ApiErrorException（断网）→ 网络错误文案', () => {
    expect(describeRetainedVolumeError(new TypeError('fetch failed'))).toBe(
      '网络错误，请稍后重试。',
    );
  });
});
