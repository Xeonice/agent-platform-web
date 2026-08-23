// 刷新恢复的**时效**回归（本轮新增）。
//
// 背景是真踩到的一次:`selectedSandboxId` 存活于 localStorage、跨会话不失效,于是
// 12:03 那条失败沙箱在 18:00 打开页面时被捞回来渲染成失败卡——而界面上没有任何线索
// 说明它是旧的。最坏的巧合还发生了:旧记录的任务名与用户新输的指令一字不差,连名字
// 都对得上,用户完全无法从界面分辨,反复以为"我刚才这次又失败了"。
//
// 修法不是"一律按时长丢弃":无头任务有 2h/4h 档,关掉标签页两小时后回来,那条**仍在跑**
// 的选中理应还在。要砍的只是**已结束**的那种。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { useSandboxRestore } from '@/hooks/useSandboxRestore';
import { useAppStore } from '@/stores';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const ID = 'sb-old';
const TTL = 30 * 60 * 1000;

function wrapper(): ({ children }: { children: ReactNode }) => React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** 让 DTO 回一条指定状态的沙箱,并记下它被打了几次——用来证明"陈旧就不发请求"。 */
function serveSandbox(status: string): { hits: () => number } {
  let n = 0;
  server.use(
    http.get(`${API_BASE}/api/sandboxes/${ID}`, () => {
      n += 1;
      return HttpResponse.json({
        id: ID,
        projectId: 'p1',
        runtime: 'codex',
        provider: 'aio',
        name: '对项目进行分析，输出摘要',
        status,
        headless: false,
        timeoutMinutes: null,
        idleTimeoutSec: 1800,
        waitingInput: false,
        version: 0,
        ...(status === 'failed'
          ? { failureCode: 'INSTALL_FAILED', failureMessage: "unknown runtime 'shell'" }
          : {}),
      });
    }),
  );
  return { hits: () => n };
}

describe('useSandboxRestore · 终态选中的时效', () => {
  beforeEach(() => {
    useAppStore.setState({
      selectedSandboxId: ID,
      selectedSandboxTerminalAt: null,
      sandboxStatuses: {},
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('刚失败就刷新 → 照常恢复,失败原因还在（这个特性唯一该服务的场景）', async () => {
    const { hits } = serveSandbox('failed');
    // 1 分钟前进入终态:远在 TTL 之内。
    useAppStore.setState({ selectedSandboxTerminalAt: Date.now() - 60_000 });

    const { result } = renderHook(() => useSandboxRestore(ID), { wrapper: wrapper() });

    await waitFor(() => {
      expect(result.current.name).toBe('对项目进行分析，输出摘要');
    });
    expect(hits()).toBeGreaterThan(0);
    expect(useAppStore.getState().selectedSandboxId).toBe(ID);
    expect(useAppStore.getState().sandboxStatuses[ID]?.failureCode).toBe('INSTALL_FAILED');
  });

  it('几小时前的失败 → 不恢复、不渲染,并且**根本不发那次请求**', async () => {
    const { hits } = serveSandbox('failed');
    useAppStore.setState({ selectedSandboxTerminalAt: Date.now() - (TTL + 1) });

    const { result } = renderHook(() => useSandboxRestore(ID), { wrapper: wrapper() });

    await waitFor(() => {
      expect(useAppStore.getState().selectedSandboxId).toBeNull();
    });
    // 判据不止"没渲染":一次注定只为渲染幽灵卡的请求本身就不该发出去。
    expect(hits()).toBe(0);
    expect(result.current.name).toBeUndefined();
    expect(result.current.isPending).toBe(false);
  });

  it('⚠️ 仍在跑的沙箱**不受时效限制**——无头任务有 2h/4h 档,隔两小时回来它还在跑', async () => {
    const { hits } = serveSandbox('running');
    // 关键:即便戳很旧(比如上一轮它曾短暂进过终态又被重建),只要当前不是终态就照常恢复。
    // 这条用例的存在是为了挡住"图省事按 selectedAt 一刀切"那种改法。
    useAppStore.setState({ selectedSandboxTerminalAt: null });

    const { result } = renderHook(() => useSandboxRestore(ID), { wrapper: wrapper() });

    await waitFor(() => {
      expect(result.current.name).toBe('对项目进行分析，输出摘要');
    });
    expect(hits()).toBeGreaterThan(0);
    expect(useAppStore.getState().selectedSandboxId).toBe(ID);
  });

  it('⚠️ 活着的沙箱**绝不打戳**——打了,它就会在下一次冷启动被当成旧记录丢掉', async () => {
    // 这条钉的是终态集合本身。`createSandboxStatusSlice` 里另有一个
    // `INSTALL_TERMINAL_STATUSES`,它含 `running` / `idle`——因为它回答的是"装 CLI 的进度
    // 还有没有意义",不是"这条沙箱的故事讲完了没有"。误共用那张表不会当场出错:活着的
    // 沙箱被打上戳,这一轮照样正常恢复;要等到几小时后的下一次冷启动,那条**仍在跑**的
    // 任务才会被静默丢掉——最难查的那种时序错。所以在这里当场钉死。
    serveSandbox('running');
    const { result } = renderHook(() => useSandboxRestore(ID), { wrapper: wrapper() });
    await waitFor(() => {
      expect(result.current.name).toBeDefined();
    });
    expect(useAppStore.getState().sandboxStatuses[ID]?.status).toBe('running');
    expect(useAppStore.getState().selectedSandboxTerminalAt).toBeNull();
  });

  it('第一次观察到终态才打戳,之后的冷启动**不刷新它**（否则时钟永远归零、永不过期）', async () => {
    serveSandbox('failed');
    const t0 = new Date('2026-08-23T12:03:00Z').getTime();
    vi.useFakeTimers();
    vi.setSystemTime(t0);

    const { unmount } = renderHook(() => useSandboxRestore(ID), { wrapper: wrapper() });
    await vi.waitFor(() => {
      expect(useAppStore.getState().selectedSandboxTerminalAt).not.toBeNull();
    });
    // 不断言等于 t0:假定时器下 waitFor 会推进时钟,戳落在"effect 真正跑的那一刻"。
    // 这条用例要钉的是**它之后不再变**,不是它精确等于哪一毫秒。
    const first = useAppStore.getState().selectedSandboxTerminalAt;
    unmount();

    // 模拟"10 分钟后又刷新一次":状态被重新种子,但戳必须还停在 t0。
    vi.setSystemTime(t0 + 10 * 60 * 1000);
    useAppStore.setState({ sandboxStatuses: {} });
    renderHook(() => useSandboxRestore(ID), { wrapper: wrapper() });
    await vi.waitFor(() => {
      expect(useAppStore.getState().sandboxStatuses[ID]).toBeDefined();
    });

    expect(useAppStore.getState().selectedSandboxTerminalAt).toBe(first);
  });

  it('换一条选中 → 上一条的戳立即作废,不让新选中继承旧时钟', () => {
    useAppStore.setState({ selectedSandboxTerminalAt: 1_700_000_000_000 });
    useAppStore.getState().setSelectedSandboxId('sb-new');
    expect(useAppStore.getState().selectedSandboxTerminalAt).toBeNull();
  });
});
