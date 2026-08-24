// Git 凭证 Query + mutation 测试（F21-3 §7.1）：列表读取 + save/revoke 成功后 invalidate。
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { useGitCredentials, gitCredentialKeys } from '@/hooks/credential/useGitCredentials';
import { useSaveGitCredential, useRevokeGitCredential } from '@/hooks/credential/useGitCredentialMutations';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

function makeClientAndWrapper(): {
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

describe('useGitCredentials', () => {
  it('GET 列表 → 掩码项（含 allowedHosts）', async () => {
    server.use(
      http.get(`${API_BASE}/api/credentials`, () =>
        HttpResponse.json([
          {
            id: 'gc-1',
            kind: 'git',
            type: 'https-token',
            maskedIdentifier: 'ghp_…ab12',
            platform: 'github',
            allowedHosts: ['github.com', 'gitlab.example.com'],
            createdAt: new Date().toISOString(),
          },
        ]),
      ),
    );
    const { wrapper } = makeClientAndWrapper();
    const { result } = renderHook(() => useGitCredentials(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.[0]?.allowedHosts).toEqual(['github.com', 'gitlab.example.com']);
    expect(result.current.data?.[0]).not.toHaveProperty('secret');
  });
});

describe('useSaveGitCredential', () => {
  it('保存成功 → invalidate git-credentials 列表', async () => {
    server.use(
      http.post(`${API_BASE}/api/credentials/git`, () =>
        HttpResponse.json(
          {
            id: 'gc-2',
            kind: 'git',
            type: 'https-token',
            maskedIdentifier: 'ghp_…ab12',
            allowedHosts: ['github.com'],
            createdAt: new Date().toISOString(),
          },
          { status: 201 },
        ),
      ),
    );
    const { client, wrapper } = makeClientAndWrapper();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSaveGitCredential(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        type: 'https-token',
        secret: 'ghp_x_ab12',
        platform: 'github',
        allowedHosts: ['github.com'],
      });
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: gitCredentialKeys.all() });
  });
});

describe('useRevokeGitCredential', () => {
  it('吊销成功 → invalidate git-credentials 列表', async () => {
    server.use(
      http.delete(
        `${API_BASE}/api/credentials/git/:id`,
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const { client, wrapper } = makeClientAndWrapper();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useRevokeGitCredential(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('gc-9');
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: gitCredentialKeys.all() });
  });
});
