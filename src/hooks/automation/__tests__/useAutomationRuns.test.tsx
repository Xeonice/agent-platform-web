// 运行历史 hook：分页 + 去重（F21-7 §7.3「历史分页」/ useAuditStream ① 同源的坑）。
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { useAutomationRuns } from '@/hooks/automation/useAutomationRuns';
import type { AutomationRunDto } from '@/types/automation';

const BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

function run(id: string, overrides: Partial<AutomationRunDto> = {}): AutomationRunDto {
  return {
    id,
    automationId: 'a1',
    status: 'success',
    retryCount: 0,
    triggeredAt: '2026-08-31T00:00:00Z',
    startedAt: '2026-08-31T00:00:00Z',
    ...overrides,
  };
}

function makeWrapper(): ({ children }: { children: ReactNode }) => React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useAutomationRuns · 首页与折叠', () => {
  it('automationId 为 null → 一个请求都不发', async () => {
    // ⚠️ 同 `useAutomations.test.tsx` 里那条：URL 上挂 spy 拦不住"带空 id 打出去"的请求
    //    （`/api/automations//runs` 匹配不上 handler）。改听 MSW 全局事件（变异 M28）。
    const urls: string[] = [];
    const onRequest = ({ request }: { request: Request }): void => {
      urls.push(request.url);
    };
    server.events.on('request:start', onRequest);
    try {
      const { result } = renderHook(() => useAutomationRuns(null, 'UTC'), {
        wrapper: makeWrapper(),
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(urls.filter((u) => u.includes('runs'))).toEqual([]);
      expect(result.current.rows).toEqual([]);
    } finally {
      server.events.removeListener('request:start', onRequest);
    }
  });

  it('⭐ previewRows 只取最近 10 条（P21-7 §3.3 折叠态）', async () => {
    const items = Array.from({ length: 20 }, (_, i) => run(`r${String(i)}`));
    server.use(
      http.get(`${BASE}/api/automations/:id/runs`, () =>
        HttpResponse.json({ items, hasMore: true }),
      ),
    );
    const { result } = renderHook(() => useAutomationRuns('a1', 'UTC'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.rows).toHaveLength(20);
    expect(result.current.previewRows).toHaveLength(10);
    expect(result.current.hasMore).toBe(true);
  });

  it('⭐ 时刻按传入的规则时区渲染，不按本机', async () => {
    server.use(
      http.get(`${BASE}/api/automations/:id/runs`, () =>
        HttpResponse.json({ items: [run('r1')], hasMore: false }),
      ),
    );
    const sh = renderHook(() => useAutomationRuns('a1', 'Asia/Shanghai'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => {
      expect(sh.result.current.rows[0]?.startedAtText).toBe('8-31 08:00');
    });
    const utc = renderHook(() => useAutomationRuns('a1', 'UTC'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(utc.result.current.rows[0]?.startedAtText).toBe('8-31 00:00');
    });
  });
});

describe('⭐⭐ 游标翻页：头部新落 run 也不会重复（offset 的老毛病已由后端换游标根治）', () => {
  it('[加载更多] 带 before=<最老一条 id>，行数追加且无重复', async () => {
    // 后端按游标返回：`before` 缺席 = 第一页；带 `before` = 严格早于那条。
    const older: Record<string, AutomationRunDto[]> = {
      __first__: ['r20', 'r19', 'r18', 'r17', 'r16'].map((id) => run(id)),
      r16: ['r15', 'r14'].map((id) => run(id)),
    };
    const requestedBefore: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/api/automations/:id/runs`, ({ request }) => {
        const before = new URL(request.url).searchParams.get('before');
        requestedBefore.push(before);
        const items = older[before ?? '__first__'] ?? [];
        return HttpResponse.json({ items, hasMore: before === null });
      }),
    );

    const { result } = renderHook(() => useAutomationRuns('a1', 'UTC'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.rows).toHaveLength(5);
    });

    act(() => {
      result.current.loadMore();
    });
    // ⭐ 关键：游标必须是**当前最老那条**的 id，不是页码
    await waitFor(() => {
      expect(requestedBefore).toContain('r16');
    });
    await waitFor(() => {
      expect(result.current.loadingMore).toBe(false);
    });

    const ids = result.current.rows.map((r) => r.id);
    expect(ids).toEqual(['r20', 'r19', 'r18', 'r17', 'r16', 'r15', 'r14']);
    // ⛔ 无重复 —— 而且这次不是靠前端去重兜的（dedupeRunsById 已删），
    //    是游标本身保证的。第一次请求的 before 必须是 null。
    expect(new Set(ids).size).toBe(ids.length);
    expect(requestedBefore[0]).toBeNull();
  });

  it('后端说 hasMore=false → 不给一个点了没反应的 [加载更多]', async () => {
    server.use(
      http.get(`${BASE}/api/automations/:id/runs`, () =>
        HttpResponse.json({ items: [run('r1'), run('r2')], hasMore: false }),
      ),
    );
    const { result } = renderHook(() => useAutomationRuns('a1', 'UTC'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.hasMore).toBe(false);
  });
});

describe('⭐ 不轮询（useAuditStream ② 的教训：infinite + refetchInterval 会重拉全部页）', () => {
  it('推进 60 秒不产生任何额外请求', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      server.use(
        http.get(`${BASE}/api/automations/:id/runs`, () => {
          calls += 1;
          return HttpResponse.json({ items: [run('r1')], hasMore: false });
        }),
      );
      const wrapper = makeWrapper();
      const hook = renderHook(() => useAutomationRuns('a1', 'UTC'), { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(hook.result.current.loading).toBe(false);
      expect(calls).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('错误分支', () => {
  it('500 → loadErrorMessage 有值，⛔ 不被"还没运行过"的空态盖住', async () => {
    server.use(
      http.get(`${BASE}/api/automations/:id/runs`, () => new HttpResponse(null, { status: 500 })),
    );
    const { result } = renderHook(() => useAutomationRuns('a1', 'UTC'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.loadErrorMessage).toBeDefined();
    });
    expect(result.current.rows).toEqual([]);
  });
});
