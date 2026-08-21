// useProviders（provider registry Query）：query key 工厂纪律 + 成功/失败态。
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { useProviders, providerKeys } from '@/hooks/useProviders';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

function makeWrapper(): {
  client: QueryClient;
  wrapper: ({ children }: { children: ReactNode }) => React.JSX.Element;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper: Wrapper };
}

describe('useProviders', () => {
  it('走 providerKeys.list() 缓存（key 工厂纪律，15 §2.1）', async () => {
    const { client, wrapper } = makeWrapper();
    const { result } = renderHook(() => useProviders(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(client.getQueryData(providerKeys.list())).toEqual(result.current.data);
    expect(providerKeys.list()).toEqual(['providers', 'list']);
    // 契约是扁平数组（不是 { providers: [...] } 包装对象）。
    expect(Array.isArray(result.current.data)).toBe(true);
  });

  it('失败 → isError（不静默降级为空列表）', async () => {
    server.use(
      http.get(`${API_BASE}/api/providers`, () =>
        HttpResponse.json(
          { code: 'INTERNAL', message: 'registry 不可用', retryable: true },
          { status: 500 },
        ),
      ),
    );
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useProviders(), { wrapper });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.data).toBeUndefined();
  });
});
