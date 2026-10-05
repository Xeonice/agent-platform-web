import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/acceptance/support/server';
import { usePresetImageProvision } from '@/hooks/system/usePresetImageProvision';
const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const PATH = `${API_BASE}/api/system/preset-image/provision`;
function sse(obj: Record<string, unknown>): string {
  return `event: ${String(obj['event'])}\ndata: ${JSON.stringify(obj)}\n\n`;
}
describe('阶段文案与条形进度各读自己的数据', () => {
  it('阶段句不追加百分比，真实进度仍原样可供进度条使用', async () => {
    const encoder = new TextEncoder();
    server.use(
      http.post(
        PATH,
        () =>
          new HttpResponse(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    sse({
                      event: 'stage',
                      stage: 'fetch',
                      status: 'running',
                      message: '正在获取镜像',
                      progress: 0.37,
                    }),
                  ),
                );
                controller.enqueue(
                  encoder.encode(sse({ event: 'done', ok: false, error: '下载中断' })),
                );
                controller.close();
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      ),
    );
    const { result } = renderHook(() => usePresetImageProvision(vi.fn()));
    act(() => {
      result.current.start();
    });
    await waitFor(() => {
      expect(result.current.error).toBe('下载中断');
    });
    expect(result.current.statusText).toBe('下载：正在获取镜像');
    expect(result.current.statusText).not.toContain('%');
    expect(result.current.progress).toBe(0.37);
  });
});

describe('同一搬运与不可搬运的冲突分开说', () => {
  it('其他标签页已在下载只显示中性提示，不当失败，不泄露开发者原句', async () => {
    server.use(
      http.post(PATH, () =>
        HttpResponse.json(
          {
            code: 'PRESET_IMAGE_PROVISION_IN_FLIGHT',
            message: 'registry 并发写同一tag竞态',
            retryable: false,
          },
          { status: 409 },
        ),
      ),
    );
    const { result } = renderHook(() => usePresetImageProvision(vi.fn()));
    act(() => {
      result.current.start();
    });
    await waitFor(() => {
      expect(result.current.notice).toContain('已经在下载了');
    });
    expect(result.current.error).toBeUndefined();
    expect(result.current.notice).not.toContain('竞态');
  });
  it('不能搬运保留平台原因并阻止再次开流', async () => {
    let count = 0;
    server.use(
      http.post(PATH, () => {
        count++;
        return HttpResponse.json(
          {
            code: 'PRESET_IMAGE_NOT_PROVISIONABLE',
            message: '这个运行环境不支持提前下载',
            retryable: false,
          },
          { status: 409 },
        );
      }),
    );
    const { result } = renderHook(() => usePresetImageProvision(vi.fn()));
    act(() => {
      result.current.start();
    });
    await waitFor(() => {
      expect(result.current.disabledReason).toBe('这个运行环境不支持提前下载');
    });
    act(() => {
      result.current.start();
    });
    expect(count).toBe(1);
  });
});
