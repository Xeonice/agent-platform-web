// 全局横幅栈的集成测试（F21-8 §4/§7.3「离线模式贯穿」/ 07 §8.4）：
// vitest + jsdom + MSW（`onUnhandledRequest: 'error'` ⇒ 多打一次请求会当场红）。
//
// ⭐ **本文件里四条是否定断言**，每一条守一个"改完看起来完全正常"的写法：
//    ① `init-status` 失败时**不出现「离线」二字**（把 error 当离线时红）；
//    ② 401 时**一条横幅都不出**（解锁框背后压红条时红）；
//    ③ 未初始化时**向导与横幅不同时出现**（把横幅挂到 `AppBootGate` 外面时红）；
//    ④ 横幅挂载**不多打一次 `init-status`**（自己 `useQuery` 一份新选项时红）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }) }));

import { GlobalBannerContainer } from '@/containers/banner/GlobalBannerContainer';
import { AppBootGate } from '@/containers/init/AppBootGate';
import { useAppStore } from '@/stores';
import { systemKeys } from '@/hooks/system/useAuditStream';
import type { DiagnoseRunState, InitStatusDto } from '@/types/system';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

const ONLINE: NonNullable<InitStatusDto['lastConnectivityCheck']> = [
  { target: 'api.openai.com', ok: true, latencyMs: 351, modelApi: true },
  { target: 'api.anthropic.com', ok: true, latencyMs: 1925, modelApi: true },
  { target: 'ghcr.io', ok: true, latencyMs: 6, modelApi: false },
];
/** ⚠️ 镜像仓库**是通的** —— 离线判定只看模型 API 那一半，这一行是这些用例的关键。 */
const OFFLINE: NonNullable<InitStatusDto['lastConnectivityCheck']> = [
  { target: 'api.openai.com', ok: false, hint: '连接超时', modelApi: true },
  { target: 'api.anthropic.com', ok: false, hint: '连接超时', modelApi: true },
  { target: 'ghcr.io', ok: true, latencyMs: 6, modelApi: false },
];
/** 只有镜像仓库挂了 ⇒ partial ⇒ **不该出横幅**（Agent 一直好好的）。 */
const PARTIAL: NonNullable<InitStatusDto['lastConnectivityCheck']> = [
  { target: 'api.openai.com', ok: true, latencyMs: 351, modelApi: true },
  { target: 'api.anthropic.com', ok: true, latencyMs: 1925, modelApi: true },
  { target: 'ghcr.io', ok: false, hint: '内网镜像站未配置', modelApi: false },
];

let initStatusCalls: number;

function serve(body: InitStatusDto | Response): void {
  server.use(
    http.get(`${API_BASE}/api/system/init-status`, () => {
      initStatusCalls += 1;
      return body instanceof Response ? body.clone() : HttpResponse.json(body);
    }),
  );
}

function status(over: Partial<InitStatusDto> = {}): InitStatusDto {
  return {
    initialized: true,
    lastConnectivityCheck: ONLINE,
    lastConnectivityCheckAt: '2026-08-29T16:11:34.000Z',
    ...over,
  };
}

/** 往 `systemKeys.diagnose()` 里种一轮跑完的结果（这条缓存只由 SSE 流写，测试同样直接写）。 */
function diagnoseRun(
  rows: NonNullable<InitStatusDto['lastConnectivityCheck']> | null,
): DiagnoseRunState {
  return {
    phase: 'done',
    timeoutMs: 5000,
    checks: [{ id: 'outbound-network', label: '外网连通' }],
    results:
      rows === null
        ? {}
        : {
            'outbound-network': {
              event: 'check',
              id: 'outbound-network',
              label: '外网连通',
              status: 'ok',
              summary: '已重新检测',
              durationMs: 293,
              detail: { results: rows },
            },
          },
  };
}

function renderBanner(children?: ReactNode, seedDiagnose?: DiagnoseRunState) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (seedDiagnose !== undefined) client.setQueryData(systemKeys.diagnose(), seedDiagnose);
  function Wrapper({ children: inner }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{inner}</QueryClientProvider>;
  }
  return render(
    <>
      <GlobalBannerContainer />
      {children}
    </>,
    { wrapper: Wrapper },
  );
}

beforeEach(() => {
  cleanup();
  initStatusCalls = 0;
  nav.push.mockClear();
  useAppStore.setState({ accessLocked: false, diagnoseAutorunRequested: false });
});
// ⚠️ store 的复位只放在 `beforeEach`：放进 `afterEach` 时它会在 RTL 自动 cleanup **之前**
// 跑到，于是给一棵还挂着的树推了一次 act 之外的更新（React 会打警告，且它与被测行为无关）。

describe('离线横幅（P21-8 §5 状态矩阵 / F21-8 §9.1 #16）', () => {
  it('⭐ 模型 API 全挂但镜像仓库通 ⇒ 🔴「离线模式：Agent 不可用 [重新检测]」', async () => {
    serve(status({ lastConnectivityCheck: OFFLINE }));
    renderBanner();
    const banner = await screen.findByTestId('banner-offline');
    expect(banner).toHaveAttribute('data-severity', 'blocking');
    expect(banner).toHaveTextContent('Agent 不可用');
    expect(screen.getByTestId('banner-action-offline')).toHaveTextContent('重新检测');
  });

  it('⭐ 只有镜像仓库不可达（partial）⇒ 一条横幅都不出', async () => {
    serve(status({ lastConnectivityCheck: PARTIAL }));
    renderBanner();
    await waitFor(() => {
      expect(initStatusCalls).toBe(1);
    });
    expect(screen.queryByTestId('banner-stack')).toBeNull();
  });

  it('全部可达 ⇒ 不出横幅', async () => {
    serve(status());
    renderBanner();
    await waitFor(() => {
      expect(initStatusCalls).toBe(1);
    });
    expect(screen.queryByTestId('banner-stack')).toBeNull();
  });
});

describe('⭐ 失败路径：读不到状态 ≠ 离线（AppBootGate 那条 fail-open 纪律的横幅侧）', () => {
  it('`init-status` 500 ⇒ 出「无法确认平台状态」，且**文案里没有「离线」**', async () => {
    serve(
      HttpResponse.json({ code: 'INTERNAL', message: '炸了', retryable: true }, { status: 500 }),
    );
    renderBanner();
    const banner = await screen.findByTestId('banner-platform-state-unknown');
    expect(banner).toHaveTextContent('炸了');
    expect(banner).toHaveTextContent('后端没起来');
    // ① 把 error 当离线渲染时，唯一会红的就是这一行。
    expect(banner).not.toHaveTextContent('离线模式');
    expect(screen.queryByTestId('banner-offline')).toBeNull();
  });

  it('⭐ 401（口令门）⇒ **一条横幅都不出**：用户该看到的是解锁框，不是它背后的红条', async () => {
    serve(
      HttpResponse.json(
        { code: 'UNAUTHORIZED', message: '需要访问口令', retryable: false },
        { status: 401 },
      ),
    );
    renderBanner();
    await waitFor(() => {
      expect(initStatusCalls).toBe(1);
    });
    expect(screen.queryByTestId('banner-stack')).toBeNull();
  });

  it('accessLocked 置位时同样闭嘴（WS 侧上报的 401 走的是这条）', async () => {
    useAppStore.setState({ accessLocked: true });
    serve(
      HttpResponse.json({ code: 'INTERNAL', message: '炸了', retryable: true }, { status: 500 }),
    );
    renderBanner();
    await waitFor(() => {
      expect(initStatusCalls).toBe(1);
    });
    expect(screen.queryByTestId('banner-stack')).toBeNull();
  });
});

describe('⭐ 与阻塞式向导互斥（结构性，不是一个 if）', () => {
  it('`initialized:false` ⇒ 渲染向导，横幅**不存在**（横幅在 children 里，children 不进树）', async () => {
    serve(status({ initialized: false, lastConnectivityCheck: OFFLINE }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <AppBootGate>
          <GlobalBannerContainer />
        </AppBootGate>
      </QueryClientProvider>,
    );
    await screen.findByTestId('init-wizard');
    // 阻塞式向导上挂一条 [重新检测]，那个按钮会把用户从一个不许离开的流程里带走。
    expect(screen.queryByTestId('banner-stack')).toBeNull();
    expect(screen.queryByTestId('banner-offline')).toBeNull();
  });

  it('⭐ 横幅与 `AppBootGate` 共用同一份 `init-status`：整棵树只打**一次**请求', async () => {
    serve(status({ lastConnectivityCheck: OFFLINE }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <AppBootGate>
          <GlobalBannerContainer />
          <div data-testid="workbench-sentinel" />
        </AppBootGate>
      </QueryClientProvider>,
    );
    await screen.findByTestId('banner-offline');
    expect(screen.getByTestId('workbench-sentinel')).toBeInTheDocument();
    // ④ 自己 `useQuery` 一份新选项（哪怕只是 staleTime 不同）时，这里会变成 2。
    expect(initStatusCalls).toBe(1);
  });
});

describe('关闭与动作（07 §8.4：🔴 不自动收起、须显式关闭）', () => {
  it('点 [关闭] ⇒ 横幅消失；⛔ 它不会自己弹回来', async () => {
    serve(status({ lastConnectivityCheck: OFFLINE }));
    renderBanner();
    await screen.findByTestId('banner-offline');
    fireEvent.click(screen.getByTestId('banner-dismiss-offline'));
    await waitFor(() => {
      expect(screen.queryByTestId('banner-offline')).toBeNull();
    });
    // 判定仍然命中，但关闭是显式的：不许在下一帧自己回来。
    await new Promise((r) => {
      setTimeout(r, 20);
    });
    expect(screen.queryByTestId('banner-offline')).toBeNull();
  });

  it('⭐ [重新检测] = 置意图位 + 跳系统状态页，⛔ 不在这里自己起一条诊断流', async () => {
    serve(status({ lastConnectivityCheck: OFFLINE }));
    renderBanner();
    await screen.findByTestId('banner-offline');
    fireEvent.click(screen.getByTestId('banner-action-offline'));
    expect(useAppStore.getState().diagnoseAutorunRequested).toBe(true);
    expect(nav.push).toHaveBeenCalledWith('/settings/system');
    // 没有第二个 `/diagnose` 所有者：本容器一次都没碰过那条流
    //（MSW `onUnhandledRequest:'error'` 之外，这里再钉一次意图）。
  });

  it('「状态未知」那条只跳转，**不**置自动诊断位（此时诊断多半也跑不通）', async () => {
    serve(
      HttpResponse.json({ code: 'INTERNAL', message: '炸了', retryable: true }, { status: 500 }),
    );
    renderBanner();
    await screen.findByTestId('banner-platform-state-unknown');
    fireEvent.click(screen.getByTestId('banner-action-platform-state-unknown'));
    expect(useAppStore.getState().diagnoseAutorunRequested).toBe(false);
    expect(nav.push).toHaveBeenCalledWith('/settings/system');
  });
});

// ————————————————————————————————————————————————————————————————
// ③ 诊断结果优先于 `init-status` 的历史快照（`useGlobalBanner` 文件头 ③）
// ————————————————————————————————————————————————————————————————
describe('⭐ [重新检测] 之后横幅要跟着变（否则它停在冷启动那一刻的结论）', () => {
  it('⭐ 历史说离线、刚跑的诊断说通了 ⇒ 横幅**消失**', async () => {
    serve(status({ lastConnectivityCheck: OFFLINE }));
    renderBanner(undefined, diagnoseRun(ONLINE));
    await waitFor(() => {
      expect(initStatusCalls).toBe(1);
    });
    // 只读 init-status 的写法在这里红：用户刚花 15 秒验证过网络已经好了，红条还挂着。
    expect(screen.queryByTestId('banner-offline')).toBeNull();
  });

  it('⭐ 历史说通、刚跑的诊断说离线 ⇒ 横幅**出现**（新故障要被看到）', async () => {
    serve(status({ lastConnectivityCheck: ONLINE }));
    renderBanner(undefined, diagnoseRun(OFFLINE));
    expect(await screen.findByTestId('banner-offline')).toBeInTheDocument();
  });

  it('这一轮没有出网那一项（例如断流）⇒ 退回历史快照，⛔ 不当作"全部不可达"', async () => {
    serve(status({ lastConnectivityCheck: ONLINE }));
    renderBanner(undefined, diagnoseRun(null));
    await waitFor(() => {
      expect(initStatusCalls).toBe(1);
    });
    expect(screen.queryByTestId('banner-offline')).toBeNull();
  });
});
