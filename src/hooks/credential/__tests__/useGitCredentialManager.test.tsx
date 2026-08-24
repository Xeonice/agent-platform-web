// 凭证编排 hook 的行为测试：聚焦「更换」token 时的表单预填（F21-3 §10.2 修）。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { useGitCredentialManager } from '@/hooks/credential/useGitCredentialManager';
import type { MaskedGitCredential } from '@/types/gitCredential';

// next/navigation：hook 顶层 useRouter；测试里不实际跳转，给个哑 push 即可。
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

function makeWrapper(): ({ children }: { children: ReactNode }) => React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  push.mockReset();
  // 挂载即拉列表；本组用例不依赖列表内容，返回空即可（onUnhandledRequest:'error' 需显式兜底）。
  server.use(http.get(`${API_BASE}/api/credentials`, () => HttpResponse.json([])));
});

const otherToken: MaskedGitCredential = {
  id: 'gc-internal',
  kind: 'git',
  type: 'https-token',
  maskedIdentifier: 'glpat_…9f2c',
  platform: 'other',
  allowedHosts: ['git.internal.example.com', 'ci.internal.example.com'],
  createdAt: new Date().toISOString(),
};

describe('useGitCredentialManager · 更换 token 预填', () => {
  it('replace(https-token) 预填被替换凭证的 platform / allowedHosts，不跳回 GitHub 默认态', async () => {
    const { result } = renderHook(() => useGitCredentialManager(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.replace(otherToken);
    });

    expect(result.current.activeForm).toBe('https');
    expect(result.current.platform).toBe('other');
    expect(result.current.allowedHosts).toEqual([
      'git.internal.example.com',
      'ci.internal.example.com',
    ]);
    // token 明文不回显，需用户重填。
    expect(result.current.token).toBe('');
  });

  it('replace 预填的 allowedHosts 是副本，改表单不影响原凭证对象', async () => {
    const { result } = renderHook(() => useGitCredentialManager(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.replace(otherToken);
    });
    act(() => {
      result.current.setAllowedHosts([
        ...result.current.allowedHosts,
        'extra.internal.example.com',
      ]);
    });

    expect(otherToken.allowedHosts).toEqual([
      'git.internal.example.com',
      'ci.internal.example.com',
    ]);
  });

  it('全新配置（openHttpsForm）仍回 GitHub 默认态', async () => {
    const { result } = renderHook(() => useGitCredentialManager(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.openHttpsForm();
    });

    expect(result.current.platform).toBe('github');
    expect(result.current.allowedHosts).toEqual(['github.com']);
  });

  it('replace(ssh-key) 打开空 SSH 表单（私钥不回显）', async () => {
    const sshCred: MaskedGitCredential = {
      id: 'gc-ssh',
      kind: 'git',
      type: 'ssh-key',
      maskedIdentifier: 'SHA256:abcd…',
      allowedHosts: [],
      createdAt: new Date().toISOString(),
    };
    const { result } = renderHook(() => useGitCredentialManager(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.replace(sshCred);
    });

    expect(result.current.activeForm).toBe('ssh');
    expect(result.current.sshKey).toBe('');
  });
});
