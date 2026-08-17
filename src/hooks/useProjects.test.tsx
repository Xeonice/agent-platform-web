// 项目列表 Query + 新建 202 补测（MSW 驱动）。
import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useProjects, useCreateProject, describeCreateProjectError } from '@/hooks/useProjects';
import { ApiErrorException } from '@/services/api/apiError';

function makeWrapper(): ({ children }: { children: ReactNode }) => React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('useProjects', () => {
  it('列出项目（GET /api/projects，MSW mock）', async () => {
    const { result } = renderHook(() => useProjects(), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.length).toBeGreaterThan(0);
    expect(result.current.data?.[0]).not.toHaveProperty('repoUrl');
  });

  it('新建 git 项目 → 202 返回 cloning', async () => {
    const { result } = renderHook(() => useCreateProject(), { wrapper: makeWrapper() });
    act(() => {
      result.current.mutate({ name: 'acme', sourceType: 'git', repoUrl: 'https://x/y.git' });
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.cloneStatus).toBe('cloning');
  });

  it('新建空项目 → 202 返回 ready（可直接就绪）', async () => {
    const { result } = renderHook(() => useCreateProject(), { wrapper: makeWrapper() });
    act(() => {
      result.current.mutate({ name: 'blank', sourceType: 'empty' });
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.cloneStatus).toBe('ready');
  });
});

describe('describeCreateProjectError', () => {
  it('409 → 名称重复友好提示', () => {
    const err = new ApiErrorException(
      { code: 'ALREADY_EXISTS', message: 'duplicate', retryable: false },
      409,
    );
    expect(describeCreateProjectError(err)).toBe('项目名已存在，请换一个名称。');
  });

  it('其余 4xx → 用后端信封文案', () => {
    const err = new ApiErrorException(
      { code: 'BAD_REQUEST', message: '名称过长', retryable: false },
      400,
    );
    expect(describeCreateProjectError(err)).toBe('名称过长');
  });

  it('网络错误 → 通用文案；null → undefined', () => {
    expect(describeCreateProjectError(new Error('Failed to fetch'))).toBe('网络错误，请稍后重试。');
    expect(describeCreateProjectError(null)).toBeUndefined();
  });
});
