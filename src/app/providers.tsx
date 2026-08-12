'use client';
// 全局 Provider 装配（app 层，只做编排）。QueryClient + sonner + dev 专属 MSW/devtools。
import { useState, useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from 'sonner';

const IS_DEV = process.env.NODE_ENV === 'development';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // 全局默认（15 §2.2）：staleTime 30s、retry 2；mutation 不自动重试。
          queries: { staleTime: 30_000, retry: 2, refetchOnWindowFocus: true },
          mutations: { retry: 0 },
        },
      }),
  );

  useEffect(() => {
    if (!IS_DEV) return;
    // dev 专属：启动 MSW 浏览器 worker（REST + WS echo）。生产 tree-shaking 排除。
    void import('@/mocks/browser').then(({ worker }) =>
      worker.start({ onUnhandledRequest: 'bypass' }),
    );
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster richColors position="top-right" />
      {IS_DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  );
}
