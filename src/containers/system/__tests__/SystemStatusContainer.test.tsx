// 系统状态四张卡的集成测试（F21-5 §7.3 + §9.2 VS-1 / VS-2）：vitest + jsdom + MSW node server
//（`onUnhandledRequest: 'error'` ⇒ 路径拼错会当场红，不会静默通过）。
//
// ⭐ 四条**证伪用例**在本文件里，它们各自针对一个"改完页面看起来完全正常、其余用例照旧
//    全绿"的写法：
//    · 诊断结果放组件局部 state  ⇒「卸载再挂载结果仍在」红（页面上完全看不出差别）
//    · 诊断运行中给整块遮罩/禁用 ⇒「运行中其它按钮仍可点」红
//    · 断流时把已有结果一起清空  ⇒「中断后已到达项仍在」红（「诊断中断」那句照样渲染）
//    · 资源 500 时渲染成 0% 水位 ⇒「失败不许伪装成空闲」那条否定断言红
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { SystemStatusContainer } from '@/containers/system/SystemStatusContainer';
import type { SystemProvidersDto, SystemResourcesDto } from '@/types/system';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const GB = 1024 ** 3;

function resources(over: Partial<SystemResourcesDto> = {}): SystemResourcesDto {
  return {
    cpu: { cores: 8, loadAvg1m: 0.8, usedPercent: 10, level: 'ok' },
    ram: { totalBytes: 16 * GB, usedBytes: 3.2 * GB, usedPercent: 20, level: 'ok' },
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
    activeTasks: 5,
    ...over,
  };
}

const PROVIDERS: SystemProvidersDto = {
  providers: [
    {
      id: 'aio',
      capabilities: {
        spawnTty: true,
        volumeMount: true,
        updateResources: true,
        pauseResume: true,
        snapshot: false,
        watchEvents: true,
        headlessTask: true,
      },
      isDefault: true,
      healthy: true,
      recentFailureRate: 0.005,
      sampleSize: 200,
      failureCount: 1,
    },
  ],
  runtimes: [],
  imageSpecs: [],
  healthWindowMs: 3_600_000,
};

interface Counts {
  resources: number;
  providers: number;
  diagnose: number;
}
let counts: Counts;

function frame(obj: Record<string, unknown>): string {
  return `event: ${String(obj['event'])}\ndata: ${JSON.stringify(obj)}\n\n`;
}

const START = frame({
  event: 'start',
  checks: [
    { id: 'container-runtime', label: '容器运行时可达' },
    { id: 'port-conflict', label: '端口占用' },
  ],
  timeoutMs: 5000,
});
const CHECK_OK = frame({
  event: 'check',
  id: 'container-runtime',
  label: '容器运行时可达',
  status: 'ok',
  summary: 'docker socket 可达',
  durationMs: 142,
});
const CHECK_PORT = frame({
  event: 'check',
  id: 'port-conflict',
  label: '端口占用',
  status: 'fail',
  summary: '端口 3000（平台 HTTP/WS 服务）被 com.docke (pid 41235) 占用',
  hint: 'lsof -nP -iTCP:3000 -sTCP:LISTEN',
  durationMs: 312,
});
const DONE = frame({
  event: 'done',
  okCount: 1,
  infoCount: 0,
  warnCount: 0,
  failCount: 1,
  totalMs: 5012,
});

function serve(
  opts: { res?: SystemResourcesDto | Response; sse?: readonly string[]; openEnded?: boolean } = {},
): void {
  const encoder = new TextEncoder();
  server.use(
    http.get(`${API_BASE}/api/system/resources`, () => {
      counts.resources += 1;
      const r = opts.res ?? resources();
      return r instanceof Response ? r.clone() : HttpResponse.json(r);
    }),
    http.get(`${API_BASE}/api/system/providers`, () => {
      counts.providers += 1;
      return HttpResponse.json(PROVIDERS);
    }),
    http.post(`${API_BASE}/api/system/diagnose`, () => {
      counts.diagnose += 1;
      const chunks = opts.sse ?? [START, CHECK_OK, CHECK_PORT, DONE];
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const c of chunks) controller.enqueue(encoder.encode(c));
          // `openEnded` = 流不 close：整轮"还在跑"的那一刻才是某些断言要的现场。
          if (opts.openEnded !== true) controller.close();
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

function renderCards(client: QueryClient = makeClient()): ReturnType<typeof render> {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<SystemStatusContainer />, { wrapper: Wrapper });
}

beforeEach(() => {
  cleanup();
  counts = { resources: 0, providers: 0, diagnose: 0 };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('30s 轮询（15 §2.2：运维看板 15s stale + 30s refetchInterval）', () => {
  it('推进 30s ⇒ resources / providers 各再取一次；推进 29s ⇒ 一次都不再取', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve();
    renderCards();
    await screen.findByText('资源充足');
    expect(counts).toMatchObject({ resources: 1, providers: 1 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000);
    });
    // ⚠️ 29s 这一半不能省：只测"30s 后有请求"时，把间隔改成 1s 也照样绿。
    expect(counts).toMatchObject({ resources: 1, providers: 1 });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await waitFor(() => {
      expect(counts).toMatchObject({ resources: 2, providers: 2 });
    });
  });
});

describe('VS-2 · 资源阈值联动（取最差维度）', () => {
  it('⭐ CPU 10% / RAM 20% / 磁盘 96% ⇒「无法创建新 Task」，且**不出现**「资源充足」', async () => {
    serve({
      res: resources({
        disk: {
          path: '/data',
          totalBytes: 200 * GB,
          usedBytes: 192 * GB,
          availableBytes: 8 * GB,
          usedPercent: 96,
          level: 'critical',
          reservedPercent: 15,
        },
      }),
    });
    renderCards();

    await screen.findByText('资源耗尽，无法创建新 Task');
    // ⚠️ 否定断言：平均（10+20+96)/3 = 42% 会被算成健康 —— 而那恰恰是最该拦住新建 Task 的时刻。
    expect(screen.queryByText('资源充足')).not.toBeInTheDocument();
    // 磁盘触发 ⇒ 它自己的出路（停 Task 不释放保留卷）。
    expect(screen.getByRole('button', { name: '清理保留卷' })).toBeInTheDocument();
  });

  it('⭐ 资源接口 500 ⇒ 说「读取失败」，⛔ 不许渲染成一条读起来很空闲的水位条', async () => {
    serve({
      res: HttpResponse.json(
        { code: 'INTERNAL', message: '读取失败', retryable: true },
        { status: 500 },
      ),
    });
    renderCards();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('资源水位读取失败');
    });
    expect(screen.queryByTestId('resource-gauge-cpu')).not.toBeInTheDocument();
    expect(screen.queryByText('资源充足')).not.toBeInTheDocument();
  });
});

describe('VS-1 · 诊断（SSE 流式 / 非阻塞 / 跨路由保留 / 断流）', () => {
  it('逐项到达逐项渲染，且第 ④ 项把「被谁占了」原样说出来（§9B）', async () => {
    serve();
    renderCards();
    await screen.findByText('资源充足');

    fireEvent.click(screen.getByRole('button', { name: '重新诊断' }));

    await waitFor(() => {
      expect(screen.getByTestId('diagnostic-item-port-conflict')).toHaveAttribute(
        'data-status',
        'fail',
      );
    });
    const row = screen.getByTestId('diagnostic-item-port-conflict');
    // 端口号 · 进程名与 pid · 平台原本要用它做什么 —— 三样都在，缺一样用户就得自己去查。
    expect(row).toHaveTextContent('3000');
    expect(row).toHaveTextContent('com.docke');
    expect(row).toHaveTextContent('pid 41235');
    expect(screen.getByTestId('diagnose-summary')).toHaveTextContent('含超时');
  });

  it('⭐ 运行中**不阻塞**：诊断进行时 [导出日志] 仍可点（无遮罩、无 disabled）', async () => {
    // 流保持打开且不发 `done`：整轮**还在跑**的那一刻正是要断言的时刻
    // （流一结束 `isDiagnosing` 就落回 false，那时断言"按钮可点"什么也证明不了）。
    serve({ sse: [START, CHECK_OK], openEnded: true });
    renderCards();
    await screen.findByText('资源充足');

    fireEvent.click(screen.getByRole('button', { name: '重新诊断' }));
    await waitFor(() => {
      expect(screen.getByTestId('diagnostic-item-container-runtime')).toHaveAttribute(
        'data-status',
        'ok',
      );
    });

    // ⚠️ 这三条一起才叫"非阻塞"：别的卡还在、别的按钮还能点、没有 disabled。
    expect(screen.getByRole('button', { name: '导出日志' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '刷新' })).toBeEnabled();
    expect(screen.getByText('资源充足')).toBeInTheDocument();
  });

  it('⭐ 结果落 Query 缓存：卸载容器再挂载（同一 client）结果仍在', async () => {
    serve();
    const client = makeClient();
    const first = renderCards(client);
    await screen.findByText('资源充足');
    fireEvent.click(screen.getByRole('button', { name: '重新诊断' }));
    await screen.findByTestId('diagnose-summary');

    // 模拟"切到 /settings/images 再切回"：容器卸载 → 重新挂载，QueryClient 不变。
    first.unmount();
    renderCards(client);

    // ⚠️ 放组件局部 state 时页面表现毫无差别，只有这一条会红 —— 而用户切走的目的，
    //    恰恰是照着结果去改配置。
    await waitFor(() => {
      expect(screen.getByTestId('diagnostic-item-port-conflict')).toHaveTextContent('com.docke');
    });
    // 只跑过一轮：重新挂载不许再打一次诊断（那会把结论换掉）。
    expect(counts.diagnose).toBe(1);
  });

  it('⭐ 断流（没有 done 帧）⇒ 显示「诊断中断」，且**已到达项一条不少**', async () => {
    serve({ sse: [START, CHECK_OK] });
    renderCards();
    await screen.findByText('资源充足');

    fireEvent.click(screen.getByRole('button', { name: '重新诊断' }));

    await waitFor(() => {
      expect(screen.getByTestId('diagnose-aborted')).toHaveTextContent('1/2');
    });
    // ⚠️ 否定式的那一半：把中断写成"清空结果"之后，「诊断中断」那句照样渲染。
    expect(screen.getByTestId('diagnostic-item-container-runtime')).toHaveTextContent(
      'docker socket 可达',
    );
    expect(screen.getByRole('button', { name: '重新诊断' })).toBeEnabled();
  });

  it('重入保护：诊断中按钮禁用，连点不会产生第二轮交错的结果', async () => {
    // 流保持打开 ⇒ mutation 一直 pending ⇒ 这一刻正是"用户会连点"的那一刻。
    serve({ sse: [START, CHECK_OK], openEnded: true });
    renderCards();
    await screen.findByText('资源充足');

    const button = screen.getByRole('button', { name: '重新诊断' });
    fireEvent.click(button);
    // 运行中它是禁用的（连点的第一道闸）。
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '诊断中…' })).toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: '诊断中…' }));
    expect(counts.diagnose).toBe(1);
  });
});
