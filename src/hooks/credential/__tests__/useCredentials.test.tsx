// useCredentials（F21-3 §7.1）：① 切未配置模式 → needs-setup（不抛错）；② 重授权成功 → 两个 invalidate；
// ③ 删除当前在用的那份 → warnActiveMode:true；④ isRowBusy 精确 scope；
// ⑤⑥⑦ **本轮新增**：受影响任务读真数据 / 查不到时不许说「没有」/ 删完追问切到另一种登录方式；
// ⑧ 列表加载失败自成一态。用默认 handlers（codex 帐号授权生效 + api-key 未配置）。
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { useCredentials } from '@/hooks/credential/useCredentials';
import { runtimeKeys, runtimeAuthKeys } from '@/hooks/credential/useRuntimes';
import type { RuntimeDto } from '@/types/runtimeCredential';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

function makeWrapper(): {
  client: QueryClient;
  wrapper: ({ children }: { children: ReactNode }) => React.JSX.Element;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper: Wrapper };
}

describe('useCredentials', () => {
  it('① 切到未配置模式（codex api-key）→ needs-setup 而非抛错 + 就地展开面板', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCredentials(), { wrapper });
    await waitFor(() => {
      expect(result.current.cards.length).toBeGreaterThan(0);
    });
    let decision: ReturnType<typeof result.current.switchMode> = null;
    act(() => {
      decision = result.current.switchMode('codex', 'api-key');
    });
    expect(decision).toEqual({ kind: 'needs-setup', mode: 'api-key', method: 'api-key' });
    // 就地展开该模式配置面板（不弹错误）。
    expect(result.current.expandedPanel).toEqual({ runtimeId: 'codex', method: 'api-key' });
    expect(result.current.pendingSwitch).toBeNull();
  });

  it('② 重授权成功（onAuthSuccess）→ 触发 runtime 两族 invalidate', async () => {
    const { client, wrapper } = makeWrapper();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCredentials(), { wrapper });
    await waitFor(() => {
      expect(result.current.cards.length).toBeGreaterThan(0);
    });
    act(() => {
      result.current.onAuthSuccess();
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: runtimeKeys.list() });
    expect(spy).toHaveBeenCalledWith({ queryKey: runtimeAuthKeys.all() });
  });

  it('③ 吊销生效中模式（codex account）→ 确认配置含 warnActiveMode:true + P0-4 文案', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCredentials(), { wrapper });
    await waitFor(() => {
      expect(result.current.cards.length).toBeGreaterThan(0);
    });
    act(() => {
      result.current.requestRevoke('codex', 'account');
    });
    const pending = result.current.pendingRevoke;
    expect(pending).not.toBeNull();
    expect(pending?.warnActiveMode).toBe(true);
    // P0-4 的两半都要在：延迟语义的断言 + **能做的那件事**。
    expect(pending?.warningText).toContain('平台这边删不掉');
    expect(pending?.followUpText).toContain('厂商后台');
    expect(pending?.credentialId).toBe('rc-codex-account');
  });

  it('④ isRowBusy 精确 scope（P2）：吊销进行中只禁那一行，不禁同卡其他行/其他卡', async () => {
    const { wrapper } = makeWrapper();
    // 吊销 DELETE 挂起不 resolve，令 revoking 保持 true 以观测 scope。
    server.use(
      http.delete(`${API_BASE}/api/runtimes/:rt/credentials/:credentialId`, async () => {
        await new Promise(() => undefined);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => useCredentials(), { wrapper });
    await waitFor(() => {
      expect(result.current.cards.length).toBeGreaterThan(0);
    });
    // 空闲：任何行都不忙。
    expect(result.current.isRowBusy('codex', 'account')).toBe(false);

    act(() => {
      result.current.requestRevoke('codex', 'account');
    });
    act(() => {
      result.current.confirmRevoke();
    });
    await waitFor(() => {
      expect(result.current.revoking).toBe(true);
    });

    // 只有正在吊销的 codex/account 那一行忙；同卡另一行、别的卡都不忙（不再全局禁）。
    expect(result.current.isRowBusy('codex', 'account')).toBe(true);
    expect(result.current.isRowBusy('codex', 'api-key')).toBe(false);
    expect(result.current.isRowBusy('claude-code', 'account')).toBe(false);
  });
});

describe('useCredentials · 删除确认里的受影响任务（P0：确认框不许撒谎）', () => {
  it('⑤ 接上真实 sandbox 列表：codex 上正在跑的任务被算进受影响清单', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useCredentials(), { wrapper });
    await waitFor(() => {
      expect(result.current.cards.length).toBeGreaterThan(0);
    });
    act(() => {
      result.current.requestRevoke('codex', 'account');
    });
    // 替身里 codex 上有两个活着的任务（running / starting）+ 一个 stopped。
    await waitFor(() => {
      expect(result.current.pendingRevoke?.affectedKnown).toBe(true);
    });
    const affected = result.current.pendingRevoke?.affected;
    expect(affected?.total).toBe(2);
    expect(affected?.items.map((t) => t.name)).toEqual(['修一下登录态刷新', '补 e2e 用例']);
  });

  it('⑥ sandbox 列表拿不到 → affectedKnown:false（「不知道」不许说成「没有」）', async () => {
    const { wrapper } = makeWrapper();
    server.use(
      http.get(`${API_BASE}/api/sandboxes`, () => new HttpResponse(null, { status: 500 })),
    );
    const { result } = renderHook(() => useCredentials(), { wrapper });
    await waitFor(() => {
      expect(result.current.cards.length).toBeGreaterThan(0);
    });
    act(() => {
      result.current.requestRevoke('codex', 'account');
    });
    // ⛔ items 同样是空数组 —— 分辨两者的唯一一位就是 affectedKnown。
    await waitFor(() => {
      expect(result.current.pendingRevoke?.affectedKnown).toBe(false);
    });
    expect(result.current.pendingRevoke?.affected.total).toBe(0);
  });

  it('⑦ 删掉当前在用的那份、另一种登录方式已配好 → 追问是否切过去（产品 §9）', async () => {
    const { wrapper } = makeWrapper();
    // 默认替身里没有「两种方式都配好」的 runtime —— 就地造一个（这一步本身就说明
    // 产品 §9 那条路在默认 fixture 下根本走不到，此前也就没人发现它没接线）。
    const bothConfigured: RuntimeDto = {
      id: 'codex',
      displayName: 'Codex',
      vendor: 'OpenAI',
      authMethods: ['oauth-device', 'api-key'],
      apiKeyPrefix: 'sk-',
      credentialStatus: 'active',
      activeAuthMethod: 'account',
      credentials: [
        { credentialId: 'rc-account', mode: 'account', maskedIdentifier: 'a***@gm', status: 'ok' },
        { credentialId: 'rc-key', mode: 'api-key', maskedIdentifier: 'sk-…ab12', status: 'ok' },
      ],
    };
    server.use(http.get(`${API_BASE}/api/runtimes`, () => HttpResponse.json([bothConfigured])));

    const { result } = renderHook(() => useCredentials(), { wrapper });
    await waitFor(() => {
      expect(result.current.cards.length).toBeGreaterThan(0);
    });

    act(() => {
      result.current.requestRevoke('codex', 'account');
    });
    expect(result.current.pendingRevoke?.otherModeConfigured).toBe(true);
    act(() => {
      result.current.confirmRevoke();
    });
    // ⛔ 不追问的后果是静默留下一个没有可用凭证的 Agent，下次发任务才撞上。
    await waitFor(() => {
      expect(result.current.pendingSwitch).not.toBeNull();
    });
    expect(result.current.pendingSwitch?.mode).toBe('api-key');
    expect(result.current.pendingSwitch?.message).toContain('要现在切过去用吗');
  });

  it('⑧ runtime 列表接口挂了 → loadError:true（此前 isError 全仓无人读）', async () => {
    const { wrapper } = makeWrapper();
    server.use(http.get(`${API_BASE}/api/runtimes`, () => new HttpResponse(null, { status: 503 })));
    const { result } = renderHook(() => useCredentials(), { wrapper });
    await waitFor(() => {
      expect(result.current.loadError).toBe(true);
    });
    // 「查不动」时卡片确实是空的 —— 正因如此，视图必须靠 loadError 而不是 cards.length 说话。
    expect(result.current.cards).toEqual([]);
  });
});
