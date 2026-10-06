import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { usePresetImageDownload } from '@/hooks/image/usePresetImageDownload';
import { server } from '@/acceptance/support/server';

const base = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const sse = (frame: Record<string, unknown>) =>
  `event: ${String(frame['event'])}\ndata: ${JSON.stringify(frame)}\n\n`;
describe('镜像页准备与真实检查结论', () => {
  it('打开不自动准备；done之后同源重检就绪才去掉offer，size未知保持null', async () => {
    let checks = 0;
    const prepare = vi.fn();
    server.use(
      http.post(`${base}/api/system/diagnose`, () => {
        checks++;
        const ready = checks > 1;
        return new HttpResponse(
          sse({
            event: 'start',
            checks: [{ id: 'preset-image', label: '预制镜像就绪' }],
            timeoutMs: 10_000,
          }) +
            sse({
              event: 'check',
              id: 'preset-image',
              label: '预制镜像就绪',
              status: ready ? 'ok' : 'info',
              step: 'staged',
              headline: ready ? '预制镜像就绪，可以立即发起任务' : '镜像还没下载到本机',
              durationMs: 1,
              detail: {
                ref: 'ghcr.io/platform/sandbox:v2',
                ...(ready
                  ? {}
                  : {
                      provision: {
                        provisionable: true,
                        from: 'ghcr.io/platform/sandbox:v2',
                        to: '本机镜像库',
                        sizeBytes: null,
                        why: '可提前下载',
                      },
                    }),
              },
            }) +
            sse({
              event: 'done',
              okCount: ready ? 1 : 0,
              infoCount: ready ? 0 : 1,
              warnCount: 0,
              failCount: 0,
              totalMs: 2,
            }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }),
      http.post(`${base}/api/system/preset-image/provision`, () => {
        prepare();
        return new HttpResponse(sse({ event: 'done', ok: true }), {
          headers: { 'content-type': 'text/event-stream' },
        });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => usePresetImageDownload(true), { wrapper });
    await waitFor(() => {
      expect(result.current.offer?.sizeBytes).toBeNull();
    });
    expect(prepare).not.toHaveBeenCalled();
    act(() => {
      result.current.start();
    });
    await waitFor(() => {
      expect(result.current.headline).toBe('预制镜像就绪，可以立即发起任务');
    });
    expect(result.current.offer).toBeUndefined();
    expect(checks).toBe(2);
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
