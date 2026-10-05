import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { useGitCredentialManager } from '@/hooks/credential/useGitCredentialManager';
import { gitCredentialProjects, gitCredentialTestRepo } from '@/lib/credential/gitDeletion';
import { useAppStore } from '@/stores';
import type { MaskedGitCredential } from '@/types/gitCredential';
import type { ProjectDto } from '@/types/project';
import { server } from './support/server';
import { API, NOW } from './support/fixtures';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const credential: MaskedGitCredential = {
  id: 'token-real-target',
  kind: 'git',
  type: 'https-token',
  maskedIdentifier: 'ghp_…ab12',
  platform: 'github',
  allowedHosts: ['github.com'],
  createdAt: NOW,
};
const project = (id: string, repoUrl?: string): ProjectDto => ({
  id,
  name: id,
  sourceType: repoUrl ? 'git' : 'empty',
  repoUrl,
  cloneStatus: 'ready',
  cloneErrorCode: null,
  taskCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
});
function manager() {
  window.history.replaceState({}, '', '/settings/credentials');
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useGitCredentialManager(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <QueryClientProvider client={query}>{children}</QueryClientProvider>
      </StrictMode>
    ),
  });
}

describe('CRD Git · 真实HTTP编排与来源边界', () => {
  it('AC-CRD-023.7：没有仓库时不发送secret，回程项目提供实际测试目标', async () => {
    const requests: unknown[] = [];
    server.use(
      http.post(`${API}/api/credentials/git/test`, async ({ request }) => {
        requests.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    const { result } = manager();
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    act(() => {
      result.current.openHttpsForm();
    });
    act(() => {
      result.current.setToken('synthetic-token');
    });
    act(() => {
      result.current.testForm();
    });
    expect(result.current.formTestResult?.message).toContain('没有可用来测试的仓库');
    expect(requests).toHaveLength(0);
    act(() => {
      useAppStore.getState().setPendingProjectCreate({
        projectId: 'clone-return',
        name: '回程项目',
        source: 'git',
        url: 'https://github.com/acme/repo.git',
      });
    });
    act(() => {
      result.current.testForm();
    });
    await waitFor(() => {
      expect(result.current.formTestResult?.ok).toBe(true);
    });
    expect(requests).toEqual([
      expect.objectContaining({
        source: 'inline',
        repoUrl: 'https://github.com/acme/repo.git',
        secret: 'synthetic-token',
      }),
    ]);
  });

  it('AC-CRD-026.2：host精确匹配，重复项目名称不改变目标仓库', () => {
    const candidates = [
      project('evil', 'https://github.com.evil.test/acme/repo.git'),
      project('同名', 'https://elsewhere.test/acme/repo.git'),
      project('同名', 'https://github.com/acme/repo.git'),
      project('ssh', 'git@github.com:acme/repo.git'),
      project('empty'),
    ];
    expect(gitCredentialProjects(credential, candidates)).toEqual(['同名']);
    expect(gitCredentialTestRepo(credential, candidates)).toBe('https://github.com/acme/repo.git');
    expect(gitCredentialProjects({ ...credential, type: 'ssh-key' }, candidates)).toEqual(['ssh']);
  });

  it('AC-CRD-026.1/026.3：确认前不删除，取消不删除，确认请求指定凭证', async () => {
    const deletions: string[] = [];
    server.use(
      http.delete(`${API}/api/credentials/git/:id`, ({ params }) => {
        deletions.push(String(params['id']));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = manager();
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    act(() => {
      result.current.revoke(credential);
    });
    expect(result.current.pendingRevoke?.title).toContain('github.com');
    expect(deletions).toEqual([]);
    act(() => {
      result.current.cancelRevoke();
    });
    expect(deletions).toEqual([]);
    act(() => {
      result.current.revoke(credential);
    });
    act(() => {
      result.current.confirmRevoke();
    });
    await waitFor(() => {
      expect(deletions).toEqual(['token-real-target']);
    });
    await waitFor(() => {
      expect(result.current.pendingRevoke).toBeNull();
    });
  });

  it('AC-CRD-034.5：StrictMode不丢回程，离开凭证页后清除回程', async () => {
    useAppStore
      .getState()
      .setPendingProjectCreate({ projectId: 'clone-return', name: '回程项目', source: 'git' });
    const { result, unmount } = manager();
    await waitFor(() => {
      expect(result.current.pendingRetry?.name).toBe('回程项目');
    });
    window.history.pushState({}, '', '/settings/images');
    unmount();
    expect(useAppStore.getState().pendingProjectCreate).toBeNull();
  });
});
