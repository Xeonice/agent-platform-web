// `useInitWizard` 的状态机（F21-8 §7.1 七条）。vitest + jsdom + MSW node server
//（`onUnhandledRequest: 'error'` ⇒ 路径拼错会当场红，不会静默通过）。
//
// ⭐ **五条证伪用例在本文件里**，每一条针对一个"改完页面看起来完全正常"的写法：
//    · 挂载即跑 `/diagnose`              ⇒「有历史结果时一个 diagnose 请求都不发」红
//    · 节流闸门用 state 而不是 ref       ⇒「连点 3 次只发 1 次」红
//    · 自动重试没有上限                  ⇒「第 3 次不再自动触发」红
//    · 把 409 一律当成"已初始化 ⇒ 放行"  ⇒「`OFFLINE_NOT_ACKNOWLEDGED` 不放行」红
//    · `PUT settings` 顺手也放行         ⇒「保存代理不发 init、initialized 仍 false」红
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { useInitWizard } from '@/hooks/system/useInitWizard';
import { systemKeys } from '@/hooks/system/useAuditStream';
import type { InitStatusDto, SystemResourcesDto, SystemSettingsDto } from '@/types/system';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const GB = 1024 ** 3;

const HISTORY: NonNullable<InitStatusDto['lastConnectivityCheck']> = [
  { target: 'api.anthropic.com', ok: true, latencyMs: 1925, modelApi: true },
  { target: 'api.openai.com', ok: true, latencyMs: 351, modelApi: true },
  { target: 'localhost:5001', ok: true, latencyMs: 6, modelApi: false },
];

function initStatus(over: Partial<InitStatusDto> = {}): InitStatusDto {
  return {
    initialized: false,
    lastConnectivityCheck: HISTORY,
    lastConnectivityCheckAt: '2026-08-29T16:11:34.000Z',
    ...over,
  };
}

const SETTINGS: SystemSettingsDto = {
  initialized: false,
  accessPasscodeEnabled: false,
  version: { platform: 'dev', node: 'v22.22.0' },
};

const RESOURCES: SystemResourcesDto = {
  cpu: { cores: 10, loadAvg1m: 3.7, usedPercent: 37, level: 'ok' },
  ram: { totalBytes: 32 * GB, usedBytes: 24 * GB, usedPercent: 76.7, level: 'ok' },
  disk: {
    path: '/data',
    totalBytes: 200 * GB,
    usedBytes: 120 * GB,
    availableBytes: 80 * GB,
    usedPercent: 60,
    level: 'ok',
    reservedPercent: 15,
  },
  retainedVolumes: { count: 0, totalBytes: 0, percentOfDisk: 0, level: 'ok', truncated: false },
  activeTasks: 0,
};

function sse(obj: Record<string, unknown>): string {
  return `event: ${String(obj['event'])}\ndata: ${JSON.stringify(obj)}\n\n`;
}

/** 一轮完整的 diagnose：只发向导关心的两项 + 汇总帧。 */
function diagnoseFrames(
  over: { outboundOk?: boolean; presetStatus?: string; presetStep?: string } = {},
): string[] {
  const outboundOk = over.outboundOk ?? true;
  return [
    sse({
      event: 'start',
      checks: [{ id: 'outbound-network', label: '外网连通' }],
      timeoutMs: 5000,
    }),
    sse({
      event: 'check',
      id: 'outbound-network',
      label: '外网连通（模型 API / 镜像仓库）',
      status: outboundOk ? 'ok' : 'warn',
      summary: '探测完成',
      detail: {
        results: [
          { target: 'api.openai.com', ok: true, latencyMs: 291, modelApi: true },
          { target: 'localhost:5001', ok: outboundOk, latencyMs: 15, modelApi: false },
        ],
      },
      durationMs: 293,
    }),
    sse({
      event: 'check',
      id: 'preset-image',
      label: '预制镜像就绪',
      status: over.presetStatus ?? 'ok',
      step: over.presetStep ?? 'staged',
      summary: '预制镜像就绪',
      durationMs: 22,
    }),
    sse({ event: 'done', okCount: 2, infoCount: 0, warnCount: 0, failCount: 0, totalMs: 300 }),
  ];
}

interface Counts {
  initStatus: number;
  diagnose: number;
  putSettings: number;
  postInit: number;
}
let counts: Counts;

interface ServeOpts {
  status?: InitStatusDto;
  /** 每次 `POST /diagnose` 的响应；数组用尽后重复最后一项。 */
  runs?: (string[] | 'abort')[];
  /** `POST /init` 的响应工厂。 */
  init?: () => Response;
  /** 第 N 次读 `init-status` 之后改回什么（模拟"另一个标签页刚初始化完"）。 */
  statusAfterInit?: InitStatusDto;
}

function serve(opts: ServeOpts = {}): void {
  const encoder = new TextEncoder();
  let initPosted = false;
  server.use(
    http.get(`${API_BASE}/api/system/init-status`, () => {
      counts.initStatus += 1;
      if (initPosted && opts.statusAfterInit !== undefined) {
        return HttpResponse.json(opts.statusAfterInit);
      }
      return HttpResponse.json(opts.status ?? initStatus());
    }),
    http.get(`${API_BASE}/api/system/settings`, () => HttpResponse.json(SETTINGS)),
    http.put(`${API_BASE}/api/system/settings`, () => {
      counts.putSettings += 1;
      return HttpResponse.json(SETTINGS);
    }),
    http.get(`${API_BASE}/api/system/resources`, () => HttpResponse.json(RESOURCES)),
    http.post(`${API_BASE}/api/system/init`, () => {
      counts.postInit += 1;
      initPosted = true;
      if (opts.init !== undefined) return opts.init();
      return HttpResponse.json(initStatus({ initialized: true }), { status: 201 });
    }),
    http.post(`${API_BASE}/api/system/diagnose`, () => {
      const index = counts.diagnose;
      counts.diagnose += 1;
      const runs = opts.runs ?? [diagnoseFrames()];
      const chunks = runs[Math.min(index, runs.length - 1)] ?? diagnoseFrames();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          if (chunks === 'abort') {
            // 断流：没有 `done` 帧就关掉 ⇒ `DiagnoseStreamAborted`。
            controller.close();
            return;
          }
          for (const c of chunks) controller.enqueue(encoder.encode(c));
          controller.close();
        },
      });
      return new HttpResponse(stream, {
        headers: { 'content-type': 'text/event-stream', 'x-schema-hash': 'sb-diagnose-v1' },
      });
    }),
  );
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderWizard(client: QueryClient = makeClient()) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, ...renderHook(() => useInitWizard(), { wrapper: Wrapper }) };
}

beforeEach(() => {
  cleanup();
  counts = { initStatus: 0, diagnose: 0, putSettings: 0, postInit: 0 };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('① 进向导不重跑检测（§8 约束 1）', () => {
  it('⭐ `init-status` 带上次检测结果 ⇒ 直接渲染历史，**一个 diagnose 请求都不发**', async () => {
    serve();
    const { result } = renderWizard();
    await waitFor(() => {
      expect(result.current.connectivity.hasResult).toBe(true);
    });
    expect(result.current.connectivity.fromHistory).toBe(true);
    expect(result.current.connectivity.checkedAtText).toContain('上次检测');
    // ⚠️ 这条否定断言是本用例的全部意义：挂载即跑的写法界面上完全一样，
    //    代价是每次冷启动干等 5s×3。
    expect(counts.diagnose).toBe(0);
  });

  it('一条历史结果都没有（新装）⇒ 自动跑一轮', async () => {
    serve({ status: { initialized: false } });
    const { result } = renderWizard();
    await waitFor(() => {
      expect(counts.diagnose).toBe(1);
    });
    await waitFor(() => {
      expect(result.current.connectivity.fromHistory).toBe(false);
    });
  });
});

describe('④ [重新检测] 3s 节流（P21-8 §7）', () => {
  it('⭐ 3s 内连点 3 次 ⇒ 只发出 1 个 diagnose 请求', async () => {
    serve();
    const { result } = renderWizard();
    await waitFor(() => {
      expect(result.current.connectivity.hasResult).toBe(true);
    });

    // ⚠️ 三下在同一个 act 里 —— 闸门若是 state（而不是 ref），三下看到的都是"没在冷却"。
    act(() => {
      result.current.recheck();
      result.current.recheck();
      result.current.recheck();
    });
    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });
    expect(counts.diagnose).toBe(1);
    expect(result.current.recheckCooldownSec).toBeGreaterThan(0);
  });
});

describe('③ 整轮最多自动重试 1 次（P21-8 §7）', () => {
  it('⭐ 自动轮次断流 ⇒ 再自动跑一次；**第 3 次不再自动触发**', async () => {
    // 三轮都断：若没有上限，这里会一直转下去。
    serve({ status: { initialized: false }, runs: ['abort'] });
    const { result } = renderWizard();
    await waitFor(() => {
      expect(counts.diagnose).toBe(2);
    });
    // 给它足够的机会去发第 3 次（有 bug 的写法会在这段时间里发好几次）。
    await new Promise((r) => setTimeout(r, 60));
    expect(counts.diagnose).toBe(2);
    expect(result.current.presetImage.phase).toBe('aborted');
  });
});

describe('② 保存代理 ≠ 放行（§8 约束 2）', () => {
  it('⭐ [保存并重新检测] 只发 `PUT /settings` + 一轮 diagnose，**不发 `POST /init`**', async () => {
    serve();
    const { result, client } = renderWizard();
    await waitFor(() => {
      expect(result.current.connectivity.hasResult).toBe(true);
    });

    act(() => {
      result.current.saveProxyAndRecheck({
        httpProxy: 'http://127.0.0.1:7890',
        httpsProxy: '',
        noProxy: 'localhost',
      });
    });
    await waitFor(() => {
      expect(counts.putSettings).toBe(1);
    });
    await waitFor(() => {
      expect(counts.diagnose).toBe(1);
    });
    // ⚠️ 两条否定断言：混用会导致"填了代理还没确认资源就进了工作台"。
    expect(counts.postInit).toBe(0);
    expect(client.getQueryData<InitStatusDto>(systemKeys.init())?.initialized).toBe(false);
  });
});

describe('⑤/⑥/⑦ `POST /init` 的三条出路', () => {
  it('成功 ⇒ `initialized` 缓存立即为 true（不再拉一次）', async () => {
    serve();
    const { result, client } = renderWizard();
    await waitFor(() => {
      expect(result.current.connectivity.hasResult).toBe(true);
    });
    act(() => {
      result.current.finish();
    });
    await waitFor(() => {
      expect(client.getQueryData<InitStatusDto>(systemKeys.init())?.initialized).toBe(true);
    });
    expect(result.current.finishError).toBeNull();
  });

  // ————————————————————————————————————————————————————————————————
  // ⑤ 两种 409 —— 处置**恰好相反**，所以两条用例必须各自钉死自己的码
  //
  // ⚠️ **只断言「抛了 409」是这一对里最容易全绿着出错的写法**：两个码互换之后，
  //    "是个 409 就行"的断言照样绿，而实际发生的是一台没初始化的机器被放进了工作台。
  //    ⇒ 一条断言"放行"、一条断言"不放行"，互换任一处实现两条一起红。
  // ————————————————————————————————————————————————————————————————

  it('⑤ 409 `ALREADY_INITIALIZED` ⇒ 放行、不显示错误，**且不再重读 `init-status`**', async () => {
    serve({
      init: () =>
        HttpResponse.json(
          { code: 'ALREADY_INITIALIZED', message: '平台已经初始化过了。', retryable: false },
          { status: 409 },
        ),
    });
    const { result, client } = renderWizard();
    await waitFor(() => {
      expect(result.current.connectivity.hasResult).toBe(true);
    });
    const readsBefore = counts.initStatus;
    act(() => {
      result.current.finish();
    });
    await waitFor(() => {
      expect(client.getQueryData<InitStatusDto>(systemKeys.init())?.initialized).toBe(true);
    });
    expect(result.current.finishError).toBeNull();
    // ⭐ **二次探测已经不必了**：码本身就是答案。这一条断言守的是"简化真的发生了"——
    //    少了它，把实现退回"每个 409 都去重读一次"也照样绿。
    expect(counts.initStatus).toBe(readsBefore);
  });

  it('⭐ 409 `OFFLINE_NOT_ACKNOWLEDGED` ⇒ **不放行**，就地显示后端那句话', async () => {
    // ⚠️ 这一种 409 下平台**根本没有**被初始化（后端标 `sideEffectFree: true`）。
    //    把它当成"已初始化 ⇒ 放行"会让用户进工作台、下次刷新又被弹回向导，
    //    而界面上一句错误都不会有。
    serve({
      init: () =>
        HttpResponse.json(
          {
            code: 'OFFLINE_NOT_ACKNOWLEDGED',
            message: '模型 API 全部不可达（api.openai.com、api.anthropic.com）—— 当前为离线环境。',
            retryable: false,
            sideEffectFree: true,
          },
          { status: 409 },
        ),
    });
    const { result, client } = renderWizard();
    await waitFor(() => {
      expect(result.current.connectivity.hasResult).toBe(true);
    });
    const readsBefore = counts.initStatus;
    act(() => {
      result.current.finish();
    });
    await waitFor(() => {
      expect(result.current.finishError).toContain('模型 API 全部不可达');
    });
    expect(client.getQueryData<InitStatusDto>(systemKeys.init())?.initialized).toBe(false);
    // 认得的码不需要再问一次状态（与上一条同源）。
    expect(counts.initStatus).toBe(readsBefore);
  });

  // ————————————————————————————————————————————————————————————————
  // 兜底：**旧版后端**两种情况共用 `INVALID_STATE`，码问不出答案 ⇒ 退回重读 `init-status`
  //
  // ⚠️ 这两条不是历史包袱：新码是 2026-08 才加的，而运维方完全可能跑着旧版后端。
  //    删掉兜底 = 对旧版后端的「已初始化」也报错误（把人卡在一个已经开好的平台前）。
  // ————————————————————————————————————————————————————————————————

  it('⑥ 旧版后端：409 `INVALID_STATE` 且 `init-status` 已是 true ⇒ 重读一次后优雅放行', async () => {
    serve({
      init: () =>
        HttpResponse.json(
          { code: 'INVALID_STATE', message: '平台已经初始化过了。', retryable: false },
          { status: 409 },
        ),
      statusAfterInit: initStatus({ initialized: true }),
    });
    const { result, client } = renderWizard();
    await waitFor(() => {
      expect(result.current.connectivity.hasResult).toBe(true);
    });
    const readsBefore = counts.initStatus;
    act(() => {
      result.current.finish();
    });
    await waitFor(() => {
      expect(client.getQueryData<InitStatusDto>(systemKeys.init())?.initialized).toBe(true);
    });
    expect(result.current.finishError).toBeNull();
    // ⭐ 认不出的码**必须**去问一次 —— 少了这一读就只剩"认不出就放行"，正是要根除的那一版。
    expect(counts.initStatus).toBeGreaterThan(readsBefore);
  });

  it('⭐ 旧版后端：409 `INVALID_STATE` 但 `init-status` 仍是 false ⇒ **不放行**', async () => {
    serve({
      init: () =>
        HttpResponse.json(
          {
            code: 'INVALID_STATE',
            message: '模型 API 全部不可达（api.openai.com、api.anthropic.com）—— 当前为离线环境。',
            retryable: false,
          },
          { status: 409 },
        ),
    });
    const { result, client } = renderWizard();
    await waitFor(() => {
      expect(result.current.connectivity.hasResult).toBe(true);
    });
    act(() => {
      result.current.finish();
    });
    await waitFor(() => {
      expect(result.current.finishError).toContain('模型 API 全部不可达');
    });
    expect(client.getQueryData<InitStatusDto>(systemKeys.init())?.initialized).toBe(false);
  });

  it('⑦ 500 ⇒ 停在向导 + 错误原因，`initialized` 仍 false', async () => {
    serve({
      init: () =>
        HttpResponse.json(
          { code: 'INTERNAL', message: '写入失败：磁盘只读', retryable: true },
          { status: 500 },
        ),
    });
    const { result, client } = renderWizard();
    await waitFor(() => {
      expect(result.current.connectivity.hasResult).toBe(true);
    });
    act(() => {
      result.current.finish();
    });
    await waitFor(() => {
      expect(result.current.finishError).toBe('写入失败：磁盘只读');
    });
    expect(client.getQueryData<InitStatusDto>(systemKeys.init())?.initialized).toBe(false);
  });
});

describe('③ 离线确认是用户的显式动作（前端不许替他填）', () => {
  it('未点 [继续] ⇒ `acknowledgeOffline` 不出现在请求体里；点过 ⇒ 才带 true', async () => {
    const bodies: unknown[] = [];
    serve();
    server.use(
      http.post(`${API_BASE}/api/system/init`, async ({ request }) => {
        bodies.push(await request.json());
        counts.postInit += 1;
        return HttpResponse.json(initStatus({ initialized: true }), { status: 201 });
      }),
    );
    const { result } = renderWizard();
    await waitFor(() => {
      expect(result.current.connectivity.hasResult).toBe(true);
    });

    act(() => {
      result.current.finish();
    });
    await waitFor(() => {
      expect(bodies).toHaveLength(1);
    });
    expect(bodies[0]).not.toHaveProperty('acknowledgeOffline');

    act(() => {
      result.current.acknowledgeOffline();
    });
    act(() => {
      result.current.finish();
    });
    await waitFor(() => {
      expect(bodies).toHaveLength(2);
    });
    expect(bodies[1]).toMatchObject({ acknowledgeOffline: true });
  });
});
