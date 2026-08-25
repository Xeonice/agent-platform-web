// 分支列表 Query + 基线同步 mutation（F21-2 §N.1 / F21-6 §9.3）。
//
// 本文件钉的四条里有三条是**否定性**的——它们正是最容易在实现时"顺手"丢掉的那些：
//  ① 空项目**不发请求**（不是"发了再忽略结果"）；
//  ② 取不到列表**不拦创建**（降级为用基线分支）；
//  ③ 全程**只命中 /branches**，一个到 git 远端的请求都没有（完整克隆的直接红利）。
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { useProjectBranches, useSyncProject } from '@/hooks/project/useProjectBranches';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

function makeWrapper(): ({ children }: { children: ReactNode }) => React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** 记录本次用例里打出去的所有请求 URL（用来断言"没有第二个端点被碰过"）。 */
let requested: string[] = [];

beforeEach(() => {
  requested = [];
  server.events.removeAllListeners('request:start');
  server.events.on('request:start', ({ request }) => {
    requested.push(request.url);
  });
});

describe('useProjectBranches', () => {
  it('① GET /api/projects/:id/branches → 本地引用列表', async () => {
    server.use(
      http.get(`${API_BASE}/api/projects/:id/branches`, () =>
        HttpResponse.json(['main', 'develop', 'feature/x']),
      ),
    );
    const { result } = renderHook(
      () => useProjectBranches({ projectId: 'p-1', isGitProject: true }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current.branches).toEqual(['main', 'develop', 'feature/x']);
    });
    expect(result.current.isError).toBe(false);
  });

  /**
   * ② **空项目不发请求**。没有 `.git`，"这个项目有哪些分支"不是"结果为空"，是问题不成立。
   * 变异：把 `enabled` 里的 `isGitProject` 去掉 ⇒ 本例的 `requested` 里会多出一条 /branches。
   */
  it('② 空项目 ⇒ enabled:false，一个请求都不发，也不停在"加载中"', async () => {
    const { result } = renderHook(
      () => useProjectBranches({ projectId: 'p-empty', isGitProject: false }),
      { wrapper: makeWrapper() },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(requested.filter((u) => u.includes('/branches'))).toHaveLength(0);
    expect(result.current.branches).toEqual([]);
    // 没发请求就不叫"加载中"——直接透 react-query 的 status 会让选择器在空项目下永远转圈。
    expect(result.current.isPending).toBe(false);
  });

  it('②b projectId 为 null（还没选项目）⇒ 同样不发请求', async () => {
    renderHook(() => useProjectBranches({ projectId: null, isGitProject: true }), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(requested.filter((u) => u.includes('/branches'))).toHaveLength(0);
  });

  /**
   * ③ 取不到列表 ⇒ `isError` 为真、列表为空。**调用方据此降级为"用基线分支"而不是拦住创建**
   *（拦住等于让一条本不该存在的失败路径挡住核心链路）。
   */
  it('③ 请求失败 ⇒ isError + 空列表（供调用方降级，不阻断创建）', async () => {
    server.use(
      http.get(`${API_BASE}/api/projects/:id/branches`, () =>
        HttpResponse.json({ code: 'INTERNAL', message: 'boom', retryable: true }, { status: 500 }),
      ),
    );
    const { result } = renderHook(
      () => useProjectBranches({ projectId: 'p-1', isGitProject: true }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.branches).toEqual([]);
  });

  /**
   * ③b 响应形状不对（后端哪天改成 `{branches:[…]}`）⇒ **当异常抛**，不让 `undefined` 漏进选择器。
   * 不做这一层校验的话，UI 会安静地渲染一串空选项，而没有任何一处报错。
   */
  it('③b 响应不是 string[] ⇒ 归一化成错误，不把坏形状喂给视图', async () => {
    server.use(
      http.get(`${API_BASE}/api/projects/:id/branches`, () =>
        HttpResponse.json({ branches: ['main'] }),
      ),
    );
    const { result } = renderHook(
      () => useProjectBranches({ projectId: 'p-1', isGitProject: true }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.branches).toEqual([]);
  });

  /**
   * ④ **不触网、不需要凭证**：整条链路上只有 /branches 一个端点被碰过 ——
   * 没有 `ls-remote`、没有 Git 凭证探测。这是完整克隆（03 §7.2★）而非"按需 fetch"的直接红利。
   */
  it('④ 只命中 /branches 一个端点（没有任何"配 Git 凭证"分支）', async () => {
    server.use(
      http.get(`${API_BASE}/api/projects/:id/branches`, () => HttpResponse.json(['main'])),
    );
    const { result } = renderHook(
      () => useProjectBranches({ projectId: 'p-1', isGitProject: true }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => {
      expect(result.current.branches).toEqual(['main']);
    });
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain('/api/projects/p-1/branches');
    expect(requested.some((u) => u.includes('credentials'))).toBe(false);
  });
});

describe('useSyncProject', () => {
  it('POST /api/projects/:id/sync（仅 ready 态由调用方把关）', async () => {
    let hit = 0;
    server.use(
      http.post(`${API_BASE}/api/projects/:id/sync`, () => {
        hit += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => useSyncProject(), { wrapper: makeWrapper() });
    act(() => {
      result.current.sync('p-1');
    });
    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
    expect(hit).toBe(1);
    expect(requested[0]).toContain('/api/projects/p-1/sync');
  });

  it('后端拒绝（非 ready 态 409）⇒ 错误透出，供只读条就地红字', async () => {
    server.use(
      http.post(`${API_BASE}/api/projects/:id/sync`, () =>
        HttpResponse.json(
          { code: 'INVALID_STATE', message: '项目未就绪，无法同步', retryable: false },
          { status: 409 },
        ),
      ),
    );
    const { result } = renderHook(() => useSyncProject(), { wrapper: makeWrapper() });
    act(() => {
      result.current.sync('p-1');
    });
    await waitFor(() => {
      expect(result.current.errorMessage).toBeDefined();
    });
    expect(result.current.needsCredentials).toBe(false);
  });

  /**
   * ★ 10A E-5：sync 的 git 失败**按 code 查人话表**，不直接渲染 message。
   *
   * 后端 sync 复用了 clone 的错误码，注释里明写着「前端已经按这些码分支了」——
   * 但那句话此前不成立：`cloneFailureGuidance` 全仓只有一处调用，读的是
   * `clone_progress` 的 WS 投影表，与 sync mutation 的 error **不同源**。
   * 于是私有仓没配凭证时点 [重新同步]，用户看到的是 `sanitizeCloneMessage(git stderr)`，
   * 一行英文；而同一个失败原因在**克隆**路径上早就有中文人话 + 凭证入口。
   *
   * MUTATION：把 `cloneFailureGuidance(code)` 换回 `m.error?.message` ⇒ 本条红。
   */
  it('权限失败 ⇒ 给中文人话 + 凭证入口，而不是把 git stderr 甩给用户', async () => {
    server.use(
      http.post(`${API_BASE}/api/projects/:id/sync`, () =>
        HttpResponse.json(
          {
            code: 'CLONE_FAILED_PERMISSION',
            // 后端这句是 sanitizeCloneMessage(git stderr) —— 给开发者看的，不是给用户看的
            message: "remote: Repository not found. fatal: repository 'https://…' not found",
            retryable: false,
          },
          { status: 403 },
        ),
      ),
    );
    const { result } = renderHook(() => useSyncProject(), { wrapper: makeWrapper() });
    act(() => {
      result.current.sync('p-1');
    });
    await waitFor(() => {
      expect(result.current.errorMessage).toBeDefined();
    });
    // 与克隆失败路径**同一句人话**（复用 cloneFailureGuidance，不另写一套词汇）
    expect(result.current.errorMessage).toContain('没有访问该仓库的权限');
    expect(result.current.errorMessage).not.toContain('fatal:');
    // 权限类失败要给出路，否则用户只知道"不行"不知道"去哪配"
    expect(result.current.needsCredentials).toBe(true);
  });
});
