// `usePresetImageProvision` 的进度/计时数据源（design/design-notes.md §1 问题 3 · §4 Phase 2
// 第 3 条）：Step3 第 5 项的 `Progress` + 计时器不许是原型里那个 `setInterval` 演示，
// 必须接真实的 provision 事件流。
//
// ⚠️ **两条各自独立，分开钉**：
//   ① `progress` 是 `ProvisionStageFrame.progress` 的**原样转发**——数字与 `null` 都要
//      原封不动地传出去，⛔ 不许在这一层做百分比之外的二次判断（那等于自己发明一个数）。
//   ② `elapsedSeconds` 是**真实挂钟时间**（`Date.now()` 差值），只在这一轮搬运真的在跑时
//      才递增；结束后归 `undefined`，⛔ 不是"看起来在动"的假动画。
//
// 与 `useSystemStatus.test.tsx` 同一条约定：走真实 MSW + `ReadableStream`，不 mock service 层
// ——这样"流协议解析对不对"与"hook 状态机对不对"在同一条用例里一起验证。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { usePresetImageProvision } from '@/hooks/system/usePresetImageProvision';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const PATH = `${API_BASE}/api/system/preset-image/provision`;

function sse(obj: Record<string, unknown>): string {
  return `event: ${String(obj['event'])}\ndata: ${JSON.stringify(obj)}\n\n`;
}

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  server.resetHandlers();
});

describe('progress：原样转发，不做二次判断', () => {
  it('数字原样传出——最后一帧报 0.42，结束后仍是 0.42（⛔ 不是被四舍五入/重算过的值）', async () => {
    const encoder = new TextEncoder();
    server.use(
      http.post(PATH, () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                sse({
                  event: 'stage',
                  stage: 'register',
                  status: 'running',
                  message: 'x',
                  progress: 0.42,
                }),
              ),
            );
            controller.enqueue(encoder.encode(sse({ event: 'done', ok: true })));
            controller.close();
          },
        });
        return new HttpResponse(stream, { headers: { 'content-type': 'text/event-stream' } });
      }),
    );

    const onFinished = vi.fn();
    const { result } = renderHook(() => usePresetImageProvision(onFinished));
    act(() => {
      result.current.start();
    });
    await waitFor(() => {
      expect(result.current.isProvisioning).toBe(false);
    });
    // MUTATION: 删掉 `usePresetImageProvision.ts` 里 `onStage` 内的 `setProgress(f.progress)`
    // ⇒ 这一条从 `0.42` 变成 `undefined`，当场红。
    expect(result.current.progress).toBe(0.42);
  });

  it('`null` 原样是 `null`，⛔ 不许被读成 0（那会显示一个停在 0% 不动的假进度条）', async () => {
    const encoder = new TextEncoder();
    server.use(
      http.post(PATH, () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                sse({
                  event: 'stage',
                  stage: 'load',
                  status: 'running',
                  message: 'x',
                  progress: null,
                }),
              ),
            );
            controller.enqueue(encoder.encode(sse({ event: 'done', ok: true })));
            controller.close();
          },
        });
        return new HttpResponse(stream, { headers: { 'content-type': 'text/event-stream' } });
      }),
    );

    const { result } = renderHook(() => usePresetImageProvision(vi.fn()));
    act(() => {
      result.current.start();
    });
    await waitFor(() => {
      expect(result.current.isProvisioning).toBe(false);
    });
    expect(result.current.progress).toBeNull();
    // 否定断言：不是"没有值"（`undefined`），是明确的"给不出"（`null`）——两者在界面上
    // 分别画不确定态 / 什么都不画，读混了会长出一个假百分比。
    expect(result.current.progress).not.toBeUndefined();
  });
});

describe('elapsedSeconds：真实挂钟时间，不是估算', () => {
  it('搬运进行中会递增；`done` 帧一到就归 `undefined`（⛔ 不是"看起来还在走"的假动画）', async () => {
    const encoder = new TextEncoder();
    let finishStream: (() => void) | undefined;
    server.use(
      http.post(PATH, () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                sse({
                  event: 'stage',
                  stage: 'register',
                  status: 'running',
                  message: '正在搬',
                  progress: null,
                }),
              ),
            );
            // ⚠️ 流刻意不立刻关闭——`elapsedSeconds` 要在"确实还在跑"的窗口期里被观察到
            // 真的在递增，而不是在流已经结束之后瞬间归零又看不出区别。
            finishStream = () => {
              controller.enqueue(encoder.encode(sse({ event: 'done', ok: true })));
              controller.close();
            };
          },
        });
        return new HttpResponse(stream, { headers: { 'content-type': 'text/event-stream' } });
      }),
    );

    const { result } = renderHook(() => usePresetImageProvision(vi.fn()));
    act(() => {
      result.current.start();
    });
    await waitFor(() => {
      expect(result.current.isProvisioning).toBe(true);
    });
    expect(result.current.elapsedSeconds).toBe(0);

    // 真实等待（不用假时钟——避免与 MSW 的 Promise/微任务调度打架），
    // 让 `setInterval` 真的走过至少一拍。
    await waitFor(
      () => {
        expect(result.current.elapsedSeconds).toBeGreaterThanOrEqual(1);
      },
      { timeout: 3000 },
    );

    act(() => {
      finishStream?.();
    });
    await waitFor(() => {
      expect(result.current.isProvisioning).toBe(false);
    });
    // MUTATION: 把 `useEffect` 里 `if (!isProvisioning) { setElapsedSeconds(undefined); return; }`
    // 删掉 ⇒ 结束后 `elapsedSeconds` 会停留在最后一个数字上，这一条从 `undefined` 变成
    // 一个数字，当场红。
    expect(result.current.elapsedSeconds).toBeUndefined();
  }, 8000);
});
