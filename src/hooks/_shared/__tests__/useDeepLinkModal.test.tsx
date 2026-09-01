// 「新建任务」弹窗的深链可寻址（F21-2 §2.1）：`/?new=1&project=<id>` ⇄ `currentModal`。
//
// 这一组盯的是**四件事**，每条都写了变异方式：
//   ① 直接访问深链 → 项目选中 + 弹窗打开；
//   ② `project` 指向不存在/已删的项目 → **不开弹窗**、不报错（并把失效参数抹掉）；
//   ③ 站内打开 → URL 出现参数（push 一次）；关闭 → 参数消失；浏览器后退 → 弹窗关闭；
//   ④ ⭐ 安全红线：URL 上**只可能**出现 `new` / `project` 两个键，指令永远不进 URL。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { useNewTaskDeepLink, readNewTaskDeepLink } from '@/hooks/_shared/useDeepLinkModal';
import { useAppStore } from '@/stores';
import type { ProjectDto } from '@/types/project';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

/** 形状咬 `ProjectDto`（生成物）：缺必填字段编译期就红。 */
function projectDto(overrides: Partial<ProjectDto> & Pick<ProjectDto, 'id'>): ProjectDto {
  return {
    name: overrides.id,
    sourceType: 'git',
    cloneStatus: 'ready',
    cloneErrorCode: null,
    taskCount: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockProjects(projects: ProjectDto[]): void {
  server.use(http.get(`${API_BASE}/api/projects`, () => HttpResponse.json(projects)));
}

function makeWrapper(): ({ children }: { children: ReactNode }) => React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** 进站 URL（jsdom 的 history 是真的，pushState/replaceState/popstate 都能跑）。 */
function enterAt(url: string): void {
  window.history.replaceState(null, '', url);
}

function renderDeepLink(): ReturnType<typeof renderHook<void, unknown>> {
  return renderHook(
    () => {
      useNewTaskDeepLink();
    },
    { wrapper: makeWrapper() },
  );
}

beforeEach(() => {
  cleanup();
  enterAt('/');
  useAppStore.getState().setCurrentModal(null);
  useAppStore.getState().setSelectedProjectId(null);
});
afterEach(() => {
  cleanup();
  enterAt('/');
});

describe('readNewTaskDeepLink · 纯解析', () => {
  it('两个参数齐全才算数', () => {
    expect(readNewTaskDeepLink('?new=1&project=p1')).toEqual({ projectId: 'p1' });
  });

  /**
   * ⛔ 不要开一个**没有项目上下文**的空弹窗（§2.1 落点表）。
   * 变异：把 `projectId === null` 那条判空删掉 ⇒ 本例变红。
   */
  it('只有 new=1、没有 project ⇒ 不算深链', () => {
    expect(readNewTaskDeepLink('?new=1')).toBeNull();
    expect(readNewTaskDeepLink('?new=1&project=')).toBeNull();
  });

  it('new 不是 1 ⇒ 不算深链（?new=0 / ?new= 都不开）', () => {
    expect(readNewTaskDeepLink('?new=0&project=p1')).toBeNull();
    expect(readNewTaskDeepLink('?project=p1')).toBeNull();
  });
});

describe('useNewTaskDeepLink · 进站消费', () => {
  /**
   * ① 完成判据 1 的前半：直接访问 `/?new=1&project=X` ⇒ 项目选中 + 弹窗打开。
   * 变异：把消费 effect 里的 `setCurrentModal('newTask')` 删掉 ⇒ 本例变红。
   */
  it('深链指向一个已就绪的项目 ⇒ 选中它并打开弹窗', async () => {
    mockProjects([projectDto({ id: 'p1' }), projectDto({ id: 'p2' })]);
    enterAt('/?new=1&project=p2');
    renderDeepLink();

    await waitFor(() => {
      expect(useAppStore.getState().currentModal).toBe('newTask');
    });
    expect(useAppStore.getState().selectedProjectId).toBe('p2');
    // 进站时 URL 本来就是对的 ⇒ **不该再 push 一遍**（push 一次，§2.1 落点表）。
    expect(window.location.search).toBe('?new=1&project=p2');
  });

  /**
   * ② 完成判据 3：`project` 指向不存在 / 已删的项目 ⇒ **不开弹窗**、不报错崩页。
   * 变异：把消费 effect 里 `if (project === undefined) return;` 删掉 ⇒ 本例变红。
   */
  it('深链指向不存在/已删的项目 ⇒ 不开弹窗，回落工作台常态（失效参数抹掉）', async () => {
    mockProjects([projectDto({ id: 'p1' })]);
    enterAt('/?new=1&project=ghost');
    renderDeepLink();

    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
    expect(useAppStore.getState().currentModal).toBeNull();
    expect(useAppStore.getState().selectedProjectId).toBeNull();
  });

  /**
   * 克隆中的项目：项目上下文照给（用户落在他要的项目上），但**不开弹窗** ——
   * 那时主区渲染的是「正在克隆」占位，`SandboxTerminalContainer` 根本没挂载，
   * 把 `currentModal` 置成 `'newTask'` 只会得到一个"开着但什么都没有"的幽灵态。
   * 变异：删掉 `if (project.cloneStatus !== 'ready') return;` ⇒ 本例变红。
   */
  it('深链指向克隆中的项目 ⇒ 选中它但不开弹窗', async () => {
    mockProjects([projectDto({ id: 'p1', cloneStatus: 'cloning' })]);
    enterAt('/?new=1&project=p1');
    renderDeepLink();

    await waitFor(() => {
      expect(useAppStore.getState().selectedProjectId).toBe('p1');
    });
    expect(useAppStore.getState().currentModal).toBeNull();
  });

  /**
   * ⚠️ 启用口令时项目列表先 401（解锁门浮出）。那时按"查无此项目"处理，会把一个
   * **有效**深链当成失效的抹掉，解锁之后再也回不来。判据因此是 `isSuccess`，
   * 不是 `!isPending`。变异：把 `if (!projects.isSuccess) return;` 改成
   * `if (projects.isPending) return;`（并把 `projects.data` 兜成 `?? []`，否则只是抛异常
   * 而不是把行为改错）⇒ 本例变红：错误态被当成"查无此项目"，参数被抹掉。
   */
  it('项目列表还没有权威答案（401）⇒ 什么都不做，参数留在 URL 上等重试', async () => {
    let hits = 0;
    server.use(
      http.get(`${API_BASE}/api/projects`, () => {
        hits += 1;
        return HttpResponse.json({ code: 'UNAUTHORIZED', message: '需要口令' }, { status: 401 });
      }),
    );
    enterAt('/?new=1&project=p1');
    renderDeepLink();
    // 等请求真的被拒过一次（否则断言只是在测"还没发出去"）。
    await waitFor(() => {
      expect(hits).toBe(1);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(window.location.search).toBe('?new=1&project=p1');
    expect(useAppStore.getState().currentModal).toBeNull();
  });
});

describe('useNewTaskDeepLink · URL 跟随弹窗', () => {
  /**
   * ③ 完成判据 2 的前半：站内点开 ⇒ URL 出现参数。
   * 变异：把 ② 那条 effect 里的 `pushState` 删掉 ⇒ 本例变红。
   */
  it('站内打开弹窗 ⇒ push 一条带参数的历史；关闭 ⇒ 参数消失', async () => {
    mockProjects([projectDto({ id: 'p1' })]);
    renderDeepLink();
    act(() => {
      useAppStore.getState().setSelectedProjectId('p1');
      useAppStore.getState().setCurrentModal('newTask');
    });

    await waitFor(() => {
      expect(window.location.search).toBe('?new=1&project=p1');
    });

    act(() => {
      useAppStore.getState().setCurrentModal(null);
    });
    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
  });

  /**
   * **push 一次，不要每次输入都写**（§2.1 落点表）。站内点开只加一条历史，
   * 弹窗开着期间的任何无关 re-render 都不该再写一次 —— 否则用户要按十几次后退才退得出去。
   * 变异：把「URL 已经一致就 return」那条去掉（改成无条件 pushState）⇒ 下一条变红。
   */
  it('站内点开只加一条历史，之后反复渲染不再写', async () => {
    mockProjects([projectDto({ id: 'p1' })]);
    const before = window.history.length;
    const { rerender } = renderDeepLink();
    act(() => {
      useAppStore.getState().setSelectedProjectId('p1');
      useAppStore.getState().setCurrentModal('newTask');
    });
    await waitFor(() => {
      expect(window.location.search).toBe('?new=1&project=p1');
    });
    for (let i = 0; i < 5; i += 1) rerender();

    expect(window.history.length).toBe(before + 1);
  });

  /**
   * ⭐ **深链进来时一条历史都不加**：URL 本来就是对的，再 push 一遍等于凭空多一条
   * 「同一个 URL」的历史 —— 用户第一次按后退什么都不会发生（弹窗还开着、地址也没变），
   * 而这恰恰是 query 方案唯一白拿的东西（「后退 = 关弹窗」）被悄悄搞坏的方式。
   *
   * 变异：把 ② 里「URL 已经一致就 return」那条去掉 ⇒ 本例变红
   *（`settled` 由 false 翻 true 时 effect 会再跑一次，那一次就会多 push 一条）。
   */
  it('⭐ 深链进入 ⇒ 一条历史都不加（URL 本来就是对的）', async () => {
    mockProjects([projectDto({ id: 'p1' })]);
    enterAt('/?new=1&project=p1');
    const before = window.history.length;
    renderDeepLink();

    await waitFor(() => {
      expect(useAppStore.getState().currentModal).toBe('newTask');
    });
    expect(window.location.search).toBe('?new=1&project=p1');
    expect(window.history.length).toBe(before);
  });

  /**
   * 其余 query 不是我的，别顺手删掉（工作台的 `?taskId=` 就是同一条 URL 上的邻居）。
   * 变异：把 `withDeepLink` 改成 `return url.pathname`（直接顶掉整个 search）⇒ 本例变红。
   */
  it('只增删 new / project 两个键，其余 query 原样保留', async () => {
    mockProjects([projectDto({ id: 'p1' })]);
    enterAt('/?taskId=sb-9');
    renderDeepLink();
    act(() => {
      useAppStore.getState().setSelectedProjectId('p1');
      useAppStore.getState().setCurrentModal('newTask');
    });
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get('new')).toBe('1');
    });
    expect(new URLSearchParams(window.location.search).get('taskId')).toBe('sb-9');

    act(() => {
      useAppStore.getState().setCurrentModal(null);
    });
    await waitFor(() => {
      expect(window.location.search).toBe('?taskId=sb-9');
    });
  });

  /**
   * ③ 完成判据 2 的后半：**浏览器后退 ⇒ 弹窗关闭**。
   * 变异：删掉 popstate 监听 ⇒ 本例变红（URL 退回去了，弹窗还开着）。
   */
  it('浏览器后退回到干净 URL ⇒ 弹窗关闭', async () => {
    mockProjects([projectDto({ id: 'p1' })]);
    renderDeepLink();
    act(() => {
      useAppStore.getState().setSelectedProjectId('p1');
      useAppStore.getState().setCurrentModal('newTask');
    });
    await waitFor(() => {
      expect(window.location.search).toBe('?new=1&project=p1');
    });

    // jsdom 不真的跑导航：手动把 URL 退回去再派发 popstate（与浏览器同序）。
    act(() => {
      enterAt('/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(useAppStore.getState().currentModal).toBeNull();
  });

  /**
   * 别的弹层（新建项目 / 已保留卷 …）**不占 URL**，一次无关的后退不该顺手把它们关掉。
   * 变异：把 popstate 里的 `currentModal === 'newTask'` 判据去掉 ⇒ 本例变红。
   */
  it('后退时不误关别的弹层', () => {
    mockProjects([projectDto({ id: 'p1' })]);
    renderDeepLink();
    act(() => {
      useAppStore.getState().setCurrentModal('createProject');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(useAppStore.getState().currentModal).toBe('createProject');
  });

  /**
   * ④ ⭐ **安全红线**（§2.1「安全红线」那行 + 完成判据 4）：`initialPrompt` 永远不进 URL。
   *
   * 这条钉的是**写 URL 那一侧的形状**：无论弹窗怎么开关，query 上出现过的键**只可能**是
   * `new` / `project`（外加进站时本来就在的那些）。
   * 变异：在 ② 那条 effect 里多写一个键（例如 `url.searchParams.set('prompt', …)`）⇒ 本例变红。
   */
  it('⭐ URL 上只出现 new / project 两个键 —— 指令没有任何缝可钻', async () => {
    mockProjects([projectDto({ id: 'p1' })]);
    const seen = new Set<string>();
    const record = (): void => {
      for (const key of new URLSearchParams(window.location.search).keys()) seen.add(key);
    };

    renderDeepLink();
    record();
    act(() => {
      useAppStore.getState().setSelectedProjectId('p1');
      useAppStore.getState().setCurrentModal('newTask');
    });
    await waitFor(() => {
      expect(window.location.search).not.toBe('');
    });
    record();
    act(() => {
      useAppStore.getState().setCurrentModal(null);
    });
    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
    record();

    expect([...seen].sort()).toEqual(['new', 'project']);
  });
});
