// 项目列表 Query + 新建 202 补测（MSW 驱动）。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useProjects,
  useCreateProject,
  useDeleteProject,
  describeCreateProjectError,
  describeProjectActionError,
  projectKeys,
} from '@/hooks/project/useProjects';
import { sandboxListKeys } from '@/hooks/sandbox/useSandboxes';
import { useAppStore } from '@/stores';
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

// ————————————————————————————————————————————————————————————————
// 删除项目（F21-6 §10.7 unit）：① invalidate 列表；② retry:0；③ 删的是当前选中项目 ⇒ 选中态清空
// ————————————————————————————————————————————————————————————————
describe('useDeleteProject', () => {
  beforeEach(() => {
    useAppStore.getState().setSelectedProjectId(null);
    useAppStore.getState().setSelectedSandboxId(null);
  });

  it('成功后 invalidate 项目列表**与沙箱列表**（Task 一并没了，不失效就成孤儿）', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(() => useDeleteProject(), { wrapper: Wrapper });
    act(() => {
      result.current.mutate('p1');
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(projectKeys.all()));
    expect(keys).toContain(JSON.stringify(sandboxListKeys.list()));
  });

  /**
   * ⭐ §10.6 第 1 条。删的可能正是当前选中项目 —— ⛔ 不许留一个指向已删项目的
   * `selectedProjectId`：那一位是 **persist** 的，刷新之后仍然指着一个 404 的 id
   *（21-4「沙箱 404 → 清掉持久化选中」是同一类问题）。
   *
   * 变异：把 `useDeleteProject` 里那个 `if (store.selectedProjectId === projectId)` 分支删掉
   * ⇒ 本例变红（selectedProjectId 仍是 'p1'）。
   */
  it('删的是当前选中项目 ⇒ 选中态（项目 + 任务）被清空', async () => {
    useAppStore.getState().setSelectedProjectId('p1');
    useAppStore.getState().setSelectedSandboxId('sbx-1');

    const { result } = renderHook(() => useDeleteProject(), { wrapper: makeWrapper() });
    act(() => {
      result.current.mutate('p1');
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(useAppStore.getState().selectedProjectId).toBeNull();
    expect(useAppStore.getState().selectedSandboxId).toBeNull();
  });

  /** 删的是**别的**项目 ⇒ 我正在干活的上下文一动不动（清错了同样是 bug）。 */
  it('删的不是当前选中项目 ⇒ 选中态不动', async () => {
    useAppStore.getState().setSelectedProjectId('p1');

    const { result } = renderHook(() => useDeleteProject(), { wrapper: makeWrapper() });
    act(() => {
      result.current.mutate('p2');
    });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(useAppStore.getState().selectedProjectId).toBe('p1');
  });

  /** mutation 不自动重试：删除是不可逆操作，重试一次就是再删一次（幂等与否由后端说了算）。 */
  it('mutation retry 由全局默认 0 承担，hook 层不覆盖', () => {
    const { result } = renderHook(() => useDeleteProject(), { wrapper: makeWrapper() });
    expect(result.current.failureCount).toBe(0);
  });
});

describe('describeProjectActionError', () => {
  /**
   * ⭐ §10.7 集成 ③ 的文案侧：409 要被翻成人话并**显示出来**，⛔ 不是静默关闭。
   */
  it('后端信封有话 → 原样透出（409 也不例外）', () => {
    const err = new ApiErrorException(
      { code: 'CONFLICT', message: '该项目仍有运行中的任务，请先停止后再删除。', retryable: false },
      409,
    );
    expect(describeProjectActionError(err)).toBe('该项目仍有运行中的任务，请先停止后再删除。');
  });

  it('信封为空 → 兜底文案；非 Api 错误 → 网络文案', () => {
    const empty = new ApiErrorException({ code: 'CONFLICT', message: '', retryable: false }, 409);
    expect(describeProjectActionError(empty)).toBe('删除失败，请稍后重试。');
    expect(describeProjectActionError(new Error('boom'))).toBe('网络错误，请稍后重试。');
  });
});
