// 建沙箱 mutation 的回归（`21-2 §7.1` 里 `useCreateSandbox` 那行）。
//
// ⚠️ **21-2 §7.1 上一版列的 ①乐观插入 / ②`onError` 回滚两条在这里没有对应实现**，
// 那一行自己也已经把它们作废了：本文件只有 `mutationFn`，没有 `onMutate`/`onError`。
// 照那两条写会得到两条「测不存在行为」的测试 —— 它们要么恒绿（断言一个从没发生过的
// 回滚"没有把数据搞坏"），要么恒红（断言一个不存在的乐观插入）。所以本文件只落 ③④。
//
// ── ③ 这条断言的**牙齿长在哪儿**（写之前先把这件事说清楚，否则它就是一条假绿）──
// react-query 的 mutation **默认就是 0 次重试**，而 `useCreateSandbox` 自己没写 `retry`
// ——它靠的是 `app/providers.tsx` 的 `mutations: { retry: 0 }` 与这条默认值**同时**成立。
// 于是：wrapper 里的 QueryClient **刻意不设任何 mutation 默认值**，让这条用例只对
// 「hook 自己有没有偷偷加 retry」有反应。
// ⇒ 它守得住的退化是：有人在 `useMutation({...})` 里补一句 `retry: 2`（"建失败自动重来一次"
//    是个很自然的坏主意 —— 而建沙箱**不是幂等操作**，重来一次可能真建出第二个）。
// ⇒ 它守不住的是 `providers.tsx` 那一行被改掉；那行的归属不在本文件，登记在 21-2 §7.1。
//    **变异验证过**：在 hook 里加 `retry: 2` ⇒ 本用例红（收到 3 次 POST）。
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { useCreateSandbox, useCreateSandboxErrorView } from '@/hooks/sandbox/useCreateSandbox';
import { ApiErrorException } from '@/services/api/apiError';
import type { ErrorEnvelope } from '@/services/api/apiError';
import type { SandboxDto } from '@/types/sandbox';
import type { CreateSandboxInput } from '@/services/api/sandbox.service';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

/**
 * ⚠️ **不给 mutations 任何默认值**（见文件头 ③）：写上 `mutations: { retry: false }`
 * 会把牙齿拔掉 —— 那样 hook 里加 `retry: 2` 也照样只发一次，用例永远绿。
 */
function wrapper(): ({ children }: { children: ReactNode }) => React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const CREATED = {
  id: 'sb-1',
  projectId: 'proj-b',
  runtime: 'codex',
  provider: 'aio',
  name: '对项目进行分析，输出摘要',
  status: 'pending',
  headless: false,
  timeoutMinutes: null,
  idleTimeoutSec: 1800,
  waitingInput: false,
  version: 0,
} satisfies SandboxDto;

describe('useCreateSandbox · ③ 不自动重试（21-2 §7.1）', () => {
  it('后端 500 ⇒ `POST /api/sandboxes` 只发一次，mutation 直接落 error', async () => {
    let posts = 0;
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, () => {
        posts += 1;
        return HttpResponse.json(
          {
            code: 'INTERNAL',
            message: '内部错误',
            retryable: true,
          } satisfies ErrorEnvelope,
          { status: 500 },
        );
      }),
    );

    const { result } = renderHook(() => useCreateSandbox(), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({ projectId: 'proj-b', runtime: 'codex' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    // 正向证据：请求**确实发出去了**（≥1），否则「没有重试」可以由"根本没发请求"廉价满足。
    expect(posts).toBe(1);

    // 再等一拍：`retry` 是带退避的异步行为，落 error 的同一帧断言不足以证明"之后也没重来"。
    // 200ms 覆盖 react-query 第一次退避（默认 1000ms * 2^0 会更久，但退化写法常用 `retry:n`
    // 配默认退避，这里取一个足以让"立刻重发"露头、又不拖慢用例的窗口）。
    await new Promise((r) => setTimeout(r, 200));
    expect(posts).toBe(1);
  });
});

describe('useCreateSandbox · ④ 请求体逐字来自调用方（21-2 §7.1）', () => {
  it('`projectId` 取自传入的 variables（= 弹窗所选），hook 不改写、不补默认值', async () => {
    // `JSON.parse(text)` 而不是 `request.json() as CreateSandboxInput`：后者是一次收窄断言
    // （`no-unsafe-type-assertion` 会拦），而这里恰恰**不能**先假定形状——要断言的正是形状本身。
    // 收进数组而不是写一个 `let`：赋值发生在回调里，TS 看不见，`let` 会被收窄成 `null`
    // 而后续断言被 `no-unnecessary-condition` 判成恒真。
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, async ({ request }) => {
        bodies.push(JSON.parse(await request.text()));
        return HttpResponse.json(CREATED, { status: 201 });
      }),
    );

    const { result } = renderHook(() => useCreateSandbox(), { wrapper: wrapper() });
    const input: CreateSandboxInput = { projectId: 'proj-b', runtime: 'codex' };
    act(() => {
      result.current.mutate(input);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toEqual({ projectId: 'proj-b', runtime: 'codex' });
    // 否定断言 + 它的正向证据：上一行已经证明请求体到达过服务端（`toEqual` 对的是真收到的那个
    // 对象），所以下面这句"没有第二个知情者"不是由"请求没发出去"廉价满足的。
    // `provider` **刻意不传**（档位由后端按宿主平台决定，F21-2 §N.1）；
    // `branch` / `initialPrompt` 不选就不带（缺省 = 基线分支 / 无开场指令）。
    expect(Object.keys(bodies[0] ?? {}).sort()).toEqual(['projectId', 'runtime']);
  });

  it('传了可选字段就原样带上（`branch` / `initialPrompt` 不被 hook 归一化）', async () => {
    // 收进数组而不是写一个 `let`：赋值发生在回调里，TS 看不见，`let` 会被收窄成 `null`
    // 而后续断言被 `no-unnecessary-condition` 判成恒真。
    const bodies: Record<string, unknown>[] = [];
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, async ({ request }) => {
        bodies.push(JSON.parse(await request.text()));
        return HttpResponse.json(CREATED, { status: 201 });
      }),
    );

    const { result } = renderHook(() => useCreateSandbox(), { wrapper: wrapper() });
    act(() => {
      result.current.mutate({
        projectId: 'proj-c',
        runtime: 'claude-code',
        branch: 'feat/x',
        initialPrompt: '  跑一遍测试  ',
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    // ⚠️ `initialPrompt` 的 trim 是**容器**的事（提交即清空那一段），hook 不重复做一遍：
    // 两处都 trim 会让"到底谁负责"变模糊，而这里原样透传能把职责钉在容器上。
    expect(bodies[0]).toEqual({
      projectId: 'proj-c',
      runtime: 'claude-code',
      branch: 'feat/x',
      initialPrompt: '  跑一遍测试  ',
    });
  });
});

// ——— 同一文件里的第二个导出：错误归一化（本轮顺带补，此前零覆盖）———
//
// 两条路**互斥**是这段代码的全部意义：门口拒绝（`sideEffectFree:true`）必须走"就地改配置"，
// 绝不能渲染成"创建失败可重试"——后者会让用户以为有个任务失败了，而根本没有任务。
describe('useCreateSandboxErrorView · 两条互斥渲染路径', () => {
  it('`sideEffectFree:true` ⇒ 只给 rejection，**不给 failure**', () => {
    const error = new ApiErrorException(
      {
        code: 'UNKNOWN_RUNTIME',
        message: "unknown runtime 'shell'",
        retryable: false,
        sideEffectFree: true,
      } satisfies ErrorEnvelope,
      400,
    );
    const { result } = renderHook(() => useCreateSandboxErrorView(error));
    // 正向证据先行：确实产出了一句就地提示（非空），否定断言才有意义。
    expect(result.current.rejection).toBeTruthy();
    expect(result.current.failure).toBeUndefined();
    // 门口拒绝那句话里不许出现"重试/重新创建"——它对"什么都没发生"说的是相反的话。
    expect(result.current.rejection).not.toMatch(/重试|重新创建/);
  });

  it('未标 `sideEffectFree` ⇒ 走 failure（保守读法：不敢说"什么都没创建"）', () => {
    const error = new ApiErrorException(
      { code: 'INTERNAL', message: '内部错误', retryable: true } satisfies ErrorEnvelope,
      500,
    );
    const { result } = renderHook(() => useCreateSandboxErrorView(error));
    expect(result.current.failure?.title).toBeTruthy();
    expect(result.current.rejection).toBeUndefined();
  });

  it('error 为 null ⇒ 两条路都不给（不渲染任何错误块）', () => {
    const { result } = renderHook(() => useCreateSandboxErrorView(null));
    expect(result.current).toEqual({});
  });
});
