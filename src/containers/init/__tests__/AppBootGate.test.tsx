// 阻塞放行的集成测试（F21-8 §7.3 / §9.2 VS-1）：vitest + jsdom + MSW node server
//（`onUnhandledRequest: 'error'` ⇒ 路径拼错会当场红）。
//
// ⭐ **本文件最重要的一条是否定断言**：未初始化时不是"向导出现了"，而是**工作台节点不存在**。
//    只断言前者的话，「渲染工作台再盖一层向导」那种写法照样全绿 —— 而它的代价是工作台真的
//    挂载了：去拉项目列表、开 `/events` WS、恢复上次选中的 Task，而这台机器还没初始化完。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { AppBootGate } from '@/containers/init/AppBootGate';
import type { InitStatusDto, SystemResourcesDto, SystemSettingsDto } from '@/types/system';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const GB = 1024 ** 3;

/** 「工作台」的替身：它是否进 DOM，就是阻塞语义成不成立。 */
const WORKBENCH = 'workbench-sentinel';

const ONLINE: NonNullable<InitStatusDto['lastConnectivityCheck']> = [
  { target: 'api.anthropic.com', ok: true, latencyMs: 1925, modelApi: true },
  { target: 'api.openai.com', ok: true, latencyMs: 351, modelApi: true },
  { target: 'localhost:5001', ok: true, latencyMs: 6, modelApi: false },
];

const OFFLINE: NonNullable<InitStatusDto['lastConnectivityCheck']> = [
  { target: 'api.anthropic.com', ok: false, hint: '连接超时', modelApi: true },
  { target: 'api.openai.com', ok: false, hint: '连接超时', modelApi: true },
  // ⚠️ 镜像仓库**是通的** —— 离线判定只看模型 API 那一半，这一行是这条用例的关键。
  { target: 'localhost:5001', ok: true, latencyMs: 6, modelApi: false },
];

function status(over: Partial<InitStatusDto> = {}): InitStatusDto {
  return {
    initialized: false,
    lastConnectivityCheck: ONLINE,
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

function frames(preset: Record<string, unknown> = {}): string[] {
  return [
    sse({ event: 'start', checks: [], timeoutMs: 5000 }),
    sse({
      event: 'check',
      id: 'outbound-network',
      label: '外网连通（模型 API / 镜像仓库）',
      status: 'ok',
      summary: '均可达',
      detail: { results: ONLINE },
      durationMs: 293,
    }),
    sse({
      event: 'check',
      id: 'preset-image',
      label: '预制镜像就绪',
      status: 'ok',
      step: 'staged',
      summary: '预制镜像就绪：已注册、已在本机铺开',
      durationMs: 22,
      ...preset,
    }),
    sse({ event: 'done', okCount: 2, infoCount: 0, warnCount: 0, failCount: 0, totalMs: 300 }),
  ];
}

interface ServeOpts {
  status?: InitStatusDto | Response;
  preset?: Record<string, unknown>;
  init?: () => Response;
  /** 让 `init-status` 一直不返回（首屏 pending 的现场）。 */
  hang?: boolean;
}

let postedInit: number;

function serve(opts: ServeOpts = {}): void {
  const encoder = new TextEncoder();
  server.use(
    http.get(`${API_BASE}/api/system/init-status`, async () => {
      if (opts.hang === true) await new Promise(() => undefined);
      const s = opts.status ?? status();
      return s instanceof Response ? s.clone() : HttpResponse.json(s);
    }),
    http.get(`${API_BASE}/api/system/settings`, () => HttpResponse.json(SETTINGS)),
    http.put(`${API_BASE}/api/system/settings`, () => HttpResponse.json(SETTINGS)),
    http.get(`${API_BASE}/api/system/resources`, () => HttpResponse.json(RESOURCES)),
    http.post(`${API_BASE}/api/system/init`, () => {
      postedInit += 1;
      if (opts.init !== undefined) return opts.init();
      return HttpResponse.json(status({ initialized: true }), { status: 201 });
    }),
    http.post(`${API_BASE}/api/system/diagnose`, () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const c of frames(opts.preset)) controller.enqueue(encoder.encode(c));
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

function renderGate(child: ReactNode = <div data-testid={WORKBENCH}>工作台</div>) {
  const client = makeClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, ...render(<AppBootGate>{child}</AppBootGate>, { wrapper: Wrapper }) };
}

beforeEach(() => {
  cleanup();
  postedInit = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('阻塞放行（§9.2 VS-1 步骤 1/2）', () => {
  it('⭐ `initialized:false` ⇒ 渲染向导，且**工作台节点不存在**（不是"渲染了但被遮住"）', async () => {
    serve();
    renderGate();
    await screen.findByTestId('init-wizard');
    // ⚠️ 这一行才是断言：只断言"向导出现了"的话，两个同时渲染也照样绿。
    expect(screen.queryByTestId(WORKBENCH)).toBeNull();
  });

  it('⭐ 未初始化时的深链（`/settings/images` 的内容）同样被拦下，且 URL 不动（不做 redirect）', async () => {
    serve();
    const before = window.location.pathname;
    renderGate(<div data-testid="settings-images-sentinel">镜像管理</div>);
    await screen.findByTestId('init-wizard');
    expect(screen.queryByTestId('settings-images-sentinel')).toBeNull();
    // ⚠️ 拦截靠"不渲染"而不是跳转：redirect 会让用户完成初始化后回不到他原本要去的地方。
    expect(window.location.pathname).toBe(before);
  });

  it('`initialized:true` ⇒ 渲染子树，且向导不存在', async () => {
    serve({ status: status({ initialized: true }) });
    renderGate();
    await screen.findByTestId(WORKBENCH);
    expect(screen.queryByTestId('init-wizard')).toBeNull();
  });

  it('⭐ 判定还没回来 ⇒ 骨架；**工作台与向导都不挂**（防闪现）', async () => {
    serve({ hang: true });
    renderGate();
    await screen.findByTestId('app-boot-skeleton');
    // 先画工作台再换成向导，用户看到的是一次"进去了又被踢出来"。
    expect(screen.queryByTestId(WORKBENCH)).toBeNull();
    expect(screen.queryByTestId('init-wizard')).toBeNull();
  });

  it('⭐ `init-status` 失败 ⇒ **放行**（fail-open），不把"后端没起来"表现成"欢迎使用向导"', async () => {
    serve({
      status: HttpResponse.json(
        { code: 'INTERNAL', message: '炸了', retryable: true },
        { status: 500 },
      ),
    });
    renderGate();
    await screen.findByTestId(WORKBENCH);
    expect(screen.queryByTestId('init-wizard')).toBeNull();
  });
});

describe('阻塞语义：无 [取消]、无 Esc 逃逸（§2，全局 Esc 规则的唯一例外）', () => {
  it('⭐ DOM 里没有 [取消]，按 Esc 之后向导仍在、工作台仍不存在', async () => {
    serve();
    renderGate();
    await screen.findByTestId('init-wizard');
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
    expect(screen.queryByRole('button', { name: '关闭' })).toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getByTestId('init-wizard')).toBeInTheDocument();
    });
    expect(screen.queryByTestId(WORKBENCH)).toBeNull();
  });
});

describe('五步走完 → 放行（§9.2 VS-1 步骤 3/6/7）', () => {
  it('⭐ 出网全通过 ⇒ 跳过代理步；走完 Step3/4/5 ⇒ 工作台出现、向导卸载', async () => {
    serve();
    renderGate();
    await screen.findByTestId('init-wizard');
    // Step1：直接渲染历史结果（不重跑），并带着它的时刻。
    expect(screen.getByTestId('connectivity-checked-at')).toHaveTextContent('上次检测');

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    // ⚠️ 全通过 ⇒ 直接到第 3 步（代理那一步不进流程）。
    await screen.findByTestId('preset-image-check');
    await waitFor(() => {
      expect(screen.getByTestId('preset-step-staged')).toHaveAttribute('data-state', 'pass');
    });

    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    // Step4 订阅配置（v1.2 新增）：默认替身里凭证已配好 ⇒ [下一步]，不是 [稍后配置]。
    await screen.findByTestId('subscription-setup');
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));

    await screen.findByTestId('resource-confirm');

    fireEvent.click(await screen.findByRole('button', { name: '确认，开始使用' }));
    await screen.findByTestId(WORKBENCH);
    expect(screen.queryByTestId('init-wizard')).toBeNull();
    expect(postedInit).toBe(1);
  });

  it('⭐ `POST /init` 500 ⇒ 仍在向导内 + [重试]，工作台**不出现**', async () => {
    serve({
      init: () =>
        HttpResponse.json(
          { code: 'INTERNAL', message: '写入失败：磁盘只读', retryable: true },
          { status: 500 },
        ),
    });
    renderGate();
    await screen.findByTestId('init-wizard');
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByTestId('preset-image-check');
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByTestId('subscription-setup');
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认，开始使用' }));

    await screen.findByTestId('init-error-panel');
    expect(screen.getByTestId('init-error-panel')).toHaveTextContent('磁盘只读');
    expect(await screen.findByRole('button', { name: '重试' })).toBeInTheDocument();
    // ⚠️ 失败不放行：`initialized` 还是 false，此时进工作台会在下次刷新被弹回向导。
    expect(screen.queryByTestId(WORKBENCH)).toBeNull();
    expect(screen.getByTestId('init-wizard')).toBeInTheDocument();
  });
});

describe('Step3 预制镜像（§7A）', () => {
  it('⭐ 五步链失败在第 3 步 ⇒ 只有那一步是 ❌，且必须明示「无法发起任何任务」', async () => {
    serve({
      preset: {
        status: 'fail',
        step: 'lineage',
        errorCode: 'PRESET_IMAGE_NOT_PLATFORM_BUILT',
        summary: "'ghcr.io/agent-infra/sandbox:latest' 是上游镜像，不是平台自建的那张",
        hint: 'bash scripts/build-sandbox-image.sh',
      },
    });
    renderGate();
    await screen.findByTestId('init-wizard');
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByTestId('preset-image-check');

    await waitFor(() => {
      expect(screen.getByTestId('preset-step-lineage')).toHaveAttribute('data-state', 'fail');
    });
    // ⛔ 五步不许合成一个红灯：其余四步不是 fail。
    expect(screen.getByTestId('preset-step-config')).toHaveAttribute('data-state', 'pass');
    expect(screen.getByTestId('preset-step-registration')).toHaveAttribute('data-state', 'pending');
    expect(screen.getByTestId('preset-step-action-lineage')).toHaveTextContent(
      '注册也会被血统检查拒',
    );
    expect(screen.getByTestId('preset-image-blocked')).toHaveTextContent('无法发起任何任务');
    // ⚠️ 不阻塞：仍然放行，只是按钮上的字变了。
    expect(screen.getByRole('button', { name: '稍后配置，下一步' })).toBeEnabled();
  });

  it('⭐ 未 staged 是 ℹ️ 提示，**不是**警告/失败，且仍然 ready（没有那句「无法发起任务」）', async () => {
    serve({
      preset: {
        status: 'info',
        step: 'staged',
        summary: '预制镜像已就绪，但尚未在本机铺开 —— 首个任务需要数分钟准备镜像',
      },
    });
    renderGate();
    await screen.findByTestId('init-wizard');
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByTestId('preset-image-check');

    await waitFor(() => {
      expect(screen.getByTestId('preset-step-staged')).toHaveAttribute('data-state', 'info');
    });
    const row = screen.getByTestId('preset-step-staged');
    expect(row).toHaveTextContent('提示');
    // ⚠️ 三条否定断言：渲染成"要修的东西"会让用户去删了重推，情况更糟。
    expect(row).not.toHaveTextContent('未通过');
    expect(screen.queryByTestId('preset-image-blocked')).toBeNull();
    expect(screen.getByRole('button', { name: '下一步' })).toBeInTheDocument();
  });
});

describe('离线（§9.2 VS-1 失败路径）', () => {
  it('⭐ 模型 API 全挂但镜像仓库通 ⇒ 判离线；[下一步] 要先点过 [继续]', async () => {
    serve({ status: status({ lastConnectivityCheck: OFFLINE }) });
    renderGate();
    await screen.findByTestId('init-wizard');

    expect(screen.getByTestId('connectivity-check')).toHaveAttribute('data-verdict', 'offline');
    expect(screen.getByTestId('offline-notice')).toHaveTextContent('Agent 将不可用');
    // ⚠️ 离线**不阻断初始化**：[继续] 必须可点（air-gapped 是受支持的一档部署）。
    const next = screen.getByRole('button', { name: '下一步' });
    expect(next).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '我知道，继续' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '下一步' })).toBeEnabled();
    });
    expect(screen.getByTestId('offline-acknowledged')).toBeInTheDocument();
  });
});
