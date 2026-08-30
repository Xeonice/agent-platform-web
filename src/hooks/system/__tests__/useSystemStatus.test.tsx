// `useSystemStatus` 的横幅接缝（F21-5 §2「从横幅 [诊断] 进入 → 自动开始诊断」）。
//
// ⭐ 本文件守的是**诊断流只有一个所有者**这件事：横幅那边只置一个意图位，真正跑 `/diagnose`
//    的仍然只有这一个 hook（它有掐旧流的重入保护）。横幅若自己起一条流，两条流会交错写
//    同一个 `systemKeys.diagnose()` 缓存 —— 而界面上只是"结果有点怪"。
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { useSystemStatus } from '@/hooks/system/useSystemStatus';
import { useAppStore } from '@/stores';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

let diagnoseCalls: number;

function sse(obj: Record<string, unknown>): string {
  return `event: ${String(obj['event'])}\ndata: ${JSON.stringify(obj)}\n\n`;
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  cleanup();
  diagnoseCalls = 0;
  useAppStore.setState({ diagnoseAutorunRequested: false });
  const encoder = new TextEncoder();
  server.use(
    http.post(`${API_BASE}/api/system/diagnose`, () => {
      diagnoseCalls += 1;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(sse({ event: 'start', checks: [], timeoutMs: 5000 })));
          controller.enqueue(
            encoder.encode(
              sse({
                event: 'done',
                okCount: 0,
                infoCount: 0,
                warnCount: 0,
                failCount: 0,
                totalMs: 1,
              }),
            ),
          );
          controller.close();
        },
      });
      return new HttpResponse(stream, { headers: { 'content-type': 'text/event-stream' } });
    }),
  );
});

describe('横幅 [重新检测] 的落地（意图位 → 自动跑一轮）', () => {
  /** 变异：把那段 `useEffect` 删掉 ⇒ 本例红（按钮点了什么也不发生）。 */
  it('⭐ 意图位置位时挂载 ⇒ 自动跑一轮诊断', async () => {
    useAppStore.setState({ diagnoseAutorunRequested: true });
    renderHook(() => useSystemStatus(), { wrapper });
    await waitFor(() => {
      expect(diagnoseCalls).toBe(1);
    });
  });

  /** 变异：把 `clearAutorun()` 那一行删掉 ⇒ 本例红（下次进这一页会再无故跑一轮）。 */
  it('⭐ 跑过之后意图位立即清掉 —— 它是一次点击，不是一个开关', async () => {
    useAppStore.setState({ diagnoseAutorunRequested: true });
    renderHook(() => useSystemStatus(), { wrapper });
    await waitFor(() => {
      expect(useAppStore.getState().diagnoseAutorunRequested).toBe(false);
    });
  });

  /** 变异：把 `if (!autorunRequested) return;` 去掉 ⇒ 本例红（每次进设置页都白跑 3×5s 探测）。 */
  it('⭐ 没有意图位 ⇒ **一次都不跑**（进设置页不该自己发起出网探测）', async () => {
    const { result } = renderHook(() => useSystemStatus(), { wrapper });
    // 等两条 query 落定再断言：只在挂载后立刻断言的话，"晚一帧才发起"的写法照样绿。
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(diagnoseCalls).toBe(0);
  });
});

describe('意图位不落盘（安全/行为红线，15 §3.5 白名单）', () => {
  it('⭐ `diagnoseAutorunRequested` 不在 persist 白名单里 —— 否则每次冷启动都自己探一轮网', () => {
    useAppStore.setState({ diagnoseAutorunRequested: true });
    const raw = localStorage.getItem('agent-platform-ui') ?? '';
    expect(raw).not.toContain('diagnoseAutorunRequested');
  });
});
