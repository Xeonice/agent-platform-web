// useCredentials（F21-3 §7.1）：① 切未配置模式 → needs-setup（不抛错）；② 重授权成功 → 两个 invalidate；
// ③ 吊销生效中模式 → warnActiveMode:true。用默认 handlers（codex 帐号授权生效 + api-key 未配置）。
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCredentials } from '@/hooks/useCredentials';
import { runtimeKeys, runtimeAuthKeys } from '@/hooks/useRuntimes';

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
    expect(pending?.warningText).toContain('无法追回');
    expect(pending?.credentialId).toBe('rc-codex-account');
  });
});
