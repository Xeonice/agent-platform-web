'use client';
// 全局 Provider 装配（app 层，只做编排）。QueryClient + sonner + devtools + 可选 MSW。
import { useState, useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from 'sonner';
import { PendingCloneReturnGuard } from '@/containers/PendingCloneReturnGuard';

const IS_DEV = process.env.NODE_ENV === 'development';

/**
 * 浏览器 MSW：**默认关闭**，`NEXT_PUBLIC_API_MOCK=1 pnpm dev` 才开。
 *
 * ★ 2026-08 修正。此前是 `if (!IS_DEV) return;` —— dev 下无条件启动、且没有开关。
 * 那不是一个决策，是脚手架残留：这行随 `b76a4ad`（web 初始脚手架，2026-08-12）
 * 一起进来，当时**后端还不存在**，浏览器里开 mock 是唯一能看到东西的办法；后端做出来
 * 之后没人回头改它。
 *
 * 它的代价不是"多了一层 mock"，而是**dev 下谁都碰不到真后端、且关不掉**：本地联调、
 * 复现线上问题、验证前后端接缝全都做不了。掩盖方式还很隐蔽——`onUnhandledRequest:'bypass'`
 * 让没写 handler 的请求穿透到真后端，于是真假混着走，界面上看不出哪条是假的。
 * 实际撞上的样子：mock 的 `POST /api/projects` 回 202 `cloning`，而 `src/mocks/` 里
 * 一条 `project.clone_progress` 都没有 ⇒ 进度条永远转下去，转多久都不会动。
 *
 * 文档侧本来也没要求它：12 §4 把 MSW 限定在 **Storybook container story 层**，另有
 * 一条"E2E 层彻底不启 MSW"的边界规则（Service Worker 会让请求对 `page.route()` 不可见）。
 * Storybook 单独引 `@/mocks/handlers`，不走本文件，因此不受这个开关影响。
 */
const USE_BROWSER_MOCK = process.env['NEXT_PUBLIC_API_MOCK'] === '1';

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
    if (!USE_BROWSER_MOCK) return;
    // 显式开启时才启动 MSW 浏览器 worker（REST + WS echo）。
    void import('@/mocks/browser').then(({ worker }) =>
      worker.start({ onUnhandledRequest: 'bypass' }),
    );
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <PendingCloneReturnGuard />
      {children}
      <Toaster richColors position="top-right" />
      {IS_DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  );
}
