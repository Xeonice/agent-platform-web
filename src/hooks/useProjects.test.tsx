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
    /**
     * ⚠️ 上一版这里断言的是 `not.toHaveProperty('repoUrl')` —— 依据是 10 §7 那条
     * "「来源」字段不对外展示（产品定案）：repoUrl 不入 DTO"。**该定案已被 F21-6 §9.1 推翻**：
     * 完整克隆（03 §7.2★）之后，远端地址 / 基线体积 / 最后同步都成了用户必须看得见的信息，
     * 项目只读条就是拿它们渲染的。断言据此翻面。
     */
    expect(result.current.data?.[0]).toHaveProperty('repoUrl');
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
  it('ALREADY_EXISTS → 名称重复友好提示', () => {
    const err = new ApiErrorException(
      { code: 'ALREADY_EXISTS', message: 'duplicate', retryable: false },
      409,
    );
    expect(describeCreateProjectError(err)).toBe('项目名已存在，请换一个名称。');
  });

  /**
   * 判据读**信封里的码**，不读 HTTP 状态码 —— 与 `retryable` / `sideEffectFree` 同源纪律。
   *
   * 旧写法 `httpStatus === 409` 拿状态码当 `ALREADY_EXISTS` 的代理。后端哪天在这个端点上
   * 多返回一种 409（并发冲突、配额冲突……），用户就会被告知"项目名已存在"，而名字根本没重 ——
   * 一句**确凿的假话**，还把人推去改一个没问题的输入。把判据改回状态码，这条当场红。
   */
  it('同是 409 但码不是 ALREADY_EXISTS → 透出后端那句话，绝不硬说"名称重复"', () => {
    const err = new ApiErrorException(
      { code: 'CONFLICT', message: '该项目正在被另一处修改，请稍后再试。', retryable: true },
      409,
    );
    expect(describeCreateProjectError(err)).toBe('该项目正在被另一处修改，请稍后再试。');
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
