// 工作台编排回归（F21-2 §N.0/§N.1 + F21-6 §9）：
//  ① **[+ 新任务] 入口存在**——这是本轮最要紧的一条，此前"新建任务"没有任何入口；
//  ② 两个「新建」**形态对称**：都是 overlay（role=dialog）、Esc 都能关、都不改路由；
//  ③ 项目只读条（远端/分支/基线体积/最后同步）+ [重新同步]；
//  ④ 新建项目弹窗补上**分支输入**（`repoBranch` 契约里一直有，表单此前没接）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';

// next/navigation：新建项目的权限失败分支会 router.push 到凭证页。
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push }),
}));

// /events 是 socket.io 通道，jsdom 下没有可连的后端；本文件只测编排与弹层形态，
// 故注入一个**什么都不做**的替身（DI 而不是 mock.module，12 §3.1.1）。
const eventsSocket = vi.hoisted(() => ({ lastBase: undefined as string | undefined }));
vi.mock('@/hooks/sandbox/useSandboxEventsSocket', () => ({
  useSandboxEventsSocket: (args: { base: string }) => {
    eventsSocket.lastBase = args.base;
    return { connState: 'closed', attempt: 0 };
  },
}));

import { WorkbenchContainer } from '@/containers/workbench/WorkbenchContainer';
import { useAppStore } from '@/stores';
import type { ProjectDto } from '@/types/project';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

function projectDto(overrides: Partial<ProjectDto> & Pick<ProjectDto, 'id' | 'name'>): ProjectDto {
  return {
    sourceType: 'git',
    cloneStatus: 'ready',
    cloneErrorCode: null,
    taskCount: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    repoUrl: 'https://github.com/acme/acme-web.git',
    repoBranch: 'develop',
    baselineSizeBytes: 47_185_920,
    updatedAt: '2026-08-20T09:30:00.000Z',
    ...overrides,
  };
}

/**
 * 读取请求体为可断言的记录。**不用 `as` 断言**（14 §4 防绕过类型：测试也不例外）——
 * `Object.entries` 走一遍就把 `unknown` 变成结构上真实的键值对。
 */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const raw: unknown = await request.json();
  return typeof raw === 'object' && raw !== null ? Object.fromEntries(Object.entries(raw)) : {};
}

function mockProjects(projects: ProjectDto[]): void {
  server.use(http.get(`${API_BASE}/api/projects`, () => HttpResponse.json(projects)));
}

function mockSandboxes(list: unknown[]): void {
  server.use(http.get(`${API_BASE}/api/sandboxes`, () => HttpResponse.json(list)));
}

function renderWorkbench(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(<WorkbenchContainer />, { wrapper: Wrapper });
}

beforeEach(() => {
  cleanup();
  nav.push.mockClear();
  useAppStore.getState().setSelectedProjectId(null);
  useAppStore.getState().setSelectedSandboxId(null);
  useAppStore.getState().setCurrentModal(null);
  server.use(
    http.get(`${API_BASE}/api/projects/:id/branches`, () => HttpResponse.json(['main', 'develop'])),
  );
});
afterEach(() => {
  cleanup();
});

// ————————————————————————————————————————————————————————————————
// ① [+ 新任务] 入口（§9.1 #1 / #33）
// ————————————————————————————————————————————————————————————————
describe('WorkbenchContainer · [+ 新任务] 入口', () => {
  /**
   * ⚠️ **本轮最要紧的一条**。在此之前"新建任务"没有任何入口：那份面板是
   * `SandboxTerminalContainer` 在"沙箱为空"时的兜底渲染 —— 用户点不出来，"创建"不是一个动作。
   *
   * 变异：把 `WorkbenchShell.view` 里的 [＋ 新任务] 按钮删掉（或把 `onNewTask` 断掉）
   * ⇒ 本例与下面「打开弹层」那条同时变红。
   */
  it('入口存在，选中就绪项目后可点，点击打开「新建任务」弹层', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    renderWorkbench();

    const entry = await screen.findByRole('button', { name: /新任务/ });
    expect(entry).toBeInTheDocument();
    // 还没选项目 ⇒ 置灰（§9.1 #33：绕过会建出无项目归属的 Task）。
    expect(entry).toBeDisabled();

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /新任务/ })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: /新任务/ }));
    expect(await screen.findByTestId('modal-new-task')).toBeInTheDocument();
  });

  it('项目未就绪（克隆中）⇒ 入口置灰并说明原因', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA', cloneStatus: 'cloning' })]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /新任务/ })).toBeDisabled();
    });
    expect(screen.getByText(/项目尚未就绪/)).toBeInTheDocument();
  });
});

// ————————————————————————————————————————————————————————————————
// ② 两个弹层形态对称（§9.1 #2）
// ————————————————————————————————————————————————————————————————
describe('WorkbenchContainer · 两个「新建」形态对称', () => {
  /**
   * ⚠️ 病根：`currentModal==='createProject'` 此前被 return 成 `mainContent` ——
   * 是**主区换页**，不是弹层，`currentModal` 这个名字是假的（§N.0）。
   *
   * 变异：把新建项目改回渲染进 `terminalSlot`（去掉 ModalShell）⇒ 本例的 `role=dialog` 断言变红。
   */
  it('新建项目是 overlay（role=dialog + aria-modal），不是主区换页', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /新建项目/ }));
    const dialog = await screen.findByTestId('modal-new-project');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // 主区仍在（弹层是**盖上去**的，不是把主区换掉）。
    expect(screen.getByLabelText('项目分组任务树')).toBeInTheDocument();
  });

  it('两个弹层用同一套 overlay 类名（形态对称，不是各画各的）', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /新建项目/ }));
    const projectModalClass = (await screen.findByTestId('modal-new-project')).className;
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('modal-new-project')).not.toBeInTheDocument();
    });

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /新任务/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /新任务/ }));
    const taskModalClass = (await screen.findByTestId('modal-new-task')).className;

    expect(taskModalClass).toBe(projectModalClass);
    expect(projectModalClass).toContain('fixed inset-0 z-50');
  });

  it('Esc 关闭新建项目弹层（与新建任务同一个动作）', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /新建项目/ }));
    await screen.findByTestId('modal-new-project');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('modal-new-project')).not.toBeInTheDocument();
    });
    // 不改路由（弹层不占路由，§9.1 #2）。
    expect(nav.push).not.toHaveBeenCalled();
  });
});

// ————————————————————————————————————————————————————————————————
// ③ 新建项目：分支输入（F21-6 §9.4）
// ————————————————————————————————————————————————————————————————
describe('WorkbenchContainer · 新建项目的分支输入', () => {
  async function openCreateProject(): Promise<void> {
    mockProjects([]);
    renderWorkbench();
    fireEvent.click(await screen.findByRole('button', { name: /新建项目/ }));
    await screen.findByTestId('modal-new-project');
  }

  it('来源 = Git ⇒ 出现分支输入；填了就进请求体 repoBranch', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API_BASE}/api/projects`, async ({ request }) => {
        body = await readBody(request);
        return HttpResponse.json(
          projectDto({ id: 'p-new', name: 'acme', cloneStatus: 'cloning' }),
          {
            status: 202,
          },
        );
      }),
    );
    await openCreateProject();

    fireEvent.change(screen.getByRole('textbox', { name: /项目名称/ }), {
      target: { value: 'acme' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /仓库地址/ }), {
      target: { value: 'https://github.com/acme/acme.git' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /分支/ }), {
      target: { value: 'develop' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));

    await waitFor(() => {
      expect(body?.['repoBranch']).toBe('develop');
    });
  });

  /**
   * 留空 ⇒ **不发这个字段**，由后端走远端默认分支。
   * 变异：改成 `repoBranch: trimmedBranch || 'main'`（"顺手补个默认值"）⇒ 本例变红。
   */
  it('分支留空 ⇒ 请求体**不含** repoBranch（远端默认分支由后端决定）', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API_BASE}/api/projects`, async ({ request }) => {
        body = await readBody(request);
        return HttpResponse.json(
          projectDto({ id: 'p-new', name: 'acme', cloneStatus: 'cloning' }),
          {
            status: 202,
          },
        );
      }),
    );
    await openCreateProject();

    fireEvent.change(screen.getByRole('textbox', { name: /项目名称/ }), {
      target: { value: 'acme' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /仓库地址/ }), {
      target: { value: 'https://github.com/acme/acme.git' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));

    await waitFor(() => {
      expect(body).toBeDefined();
    });
    expect(body).not.toHaveProperty('repoBranch');
  });

  /**
   * 空项目没有远端 ⇒ 仓库地址与分支输入**同时消失**。
   * 变异：把分支输入的渲染条件改成恒真 ⇒ 本例变红。
   */
  it('来源 = 空项目 ⇒ 仓库地址与分支输入都不渲染', async () => {
    await openCreateProject();
    expect(screen.getByTestId('repo-branch-field')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: '空项目' }));
    expect(screen.queryByTestId('repo-branch-field')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /仓库地址/ })).not.toBeInTheDocument();
  });
});

// ————————————————————————————————————————————————————————————————
// ④ 项目只读条 + [重新同步]（F21-6 §9.2/§9.3）
// ————————————————————————————————————————————————————————————————
describe('WorkbenchContainer · 项目只读条', () => {
  it('选中项目 ⇒ 主区顶部四格（远端/分支/基线/最后同步），不新开页面', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    const bar = await screen.findByTestId('project-info-bar');
    expect(within(bar).getByText('https://github.com/acme/acme-web.git')).toBeInTheDocument();
    expect(within(bar).getByText('develop')).toBeInTheDocument();
    expect(within(bar).getByText('45 MB')).toBeInTheDocument();
    expect(within(bar).getByText('最后同步')).toBeInTheDocument();
    // 只读：这条上不该出现改远端 / 切默认分支 / 重新 clone 之类的入口（§9.2）。
    expect(within(bar).queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      within(bar).queryByRole('button', { name: /重新克隆|修改远端/ }),
    ).not.toBeInTheDocument();
  });

  it('[重新同步] → POST /api/projects/:id/sync（唯一的动作）', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    let hit = 0;
    server.use(
      http.post(`${API_BASE}/api/projects/:id/sync`, () => {
        hit += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    fireEvent.click(await screen.findByRole('button', { name: '重新同步' }));
    await waitFor(() => {
      expect(hit).toBe(1);
    });
  });

  /**
   * **仅 ready 态**给 [重新同步]（§9.3）。
   * 变异：把 `canSync` 改成恒真 ⇒ 本例变红。
   */
  it('克隆中/失败的项目 ⇒ 不给 [重新同步]', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA', cloneStatus: 'cloning' })]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    await screen.findByTestId('project-info-bar');
    expect(screen.queryByRole('button', { name: '重新同步' })).not.toBeInTheDocument();
  });

  it('空项目 ⇒ 整条降级为「空项目（无远端）」，时间格显示创建时间', async () => {
    mockProjects([
      projectDto({
        id: 'p1',
        name: '临时草稿',
        sourceType: 'empty',
        repoUrl: undefined,
        repoBranch: undefined,
        baselineSizeBytes: undefined,
        updatedAt: undefined,
      }),
    ]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /临时草稿/ }));
    const bar = await screen.findByTestId('project-info-bar');
    expect(within(bar).getByText(/空项目（无远端）/)).toBeInTheDocument();
    expect(within(bar).getByText('创建于')).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: '重新同步' })).not.toBeInTheDocument();
  });

  /**
   * ⏳ 契约四字段还没下发时**逐格降级为 `—`，条本身照常渲染**
   *（生成物落地后自然填满，见 types/project.ts）。
   */
  it('DTO 缺少基线四字段 ⇒ 逐格降级为「—」，不整条消失', async () => {
    mockProjects([
      projectDto({
        id: 'p1',
        name: 'ProjectA',
        repoUrl: undefined,
        repoBranch: undefined,
        baselineSizeBytes: undefined,
        updatedAt: undefined,
      }),
    ]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    const bar = await screen.findByTestId('project-info-bar');
    expect(within(bar).getAllByText('—')).toHaveLength(3);
  });
});

describe('WorkbenchContainer · 左侧任务树接真实列表', () => {
  /**
   * 盯的是一个线上真撞到的 bug：树的 tasks 实参曾被写死成常量空数组
   * （`const NO_TASKS: Sandbox[] = []`，注释写着"后续切片接入"），于是**后端有任务、
   * 树里永远 0 条**。而项目后面的计数走另一条路（`ProjectDto.taskCount`）⇒ 界面上是
   * "写着 ·1，展开一条都没有"。
   *
   * MUTATION：把 `sandboxes.data ?? EMPTY_TASKS` 改回 `EMPTY_TASKS` → 本条红。
   */
  it('后端返回的 sandbox 出现在对应项目下（不是只有计数）', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA', taskCount: 1 })]);
    mockSandboxes([
      {
        id: 'sbx-1',
        projectId: 'p1',
        runtime: 'codex',
        provider: 'aio',
        name: '分析这个仓库',
        status: 'running',
        headless: false,
        timeoutMinutes: null,
        idleTimeoutSec: 1800,
        waitingInput: false,
        version: 0,
      },
    ]);
    renderWorkbench();

    // 任务行真的渲染出来了——而不是"在 ProjectA 中发起第一个任务 →"的空态。
    expect(await screen.findByRole('button', { name: /分析这个仓库/ })).toBeInTheDocument();
  });

  /**
   * 树把任务渲染出来还不够——点了得能打开。终端挂在 `selectedProject` 上，
   * 只设 `selectedSandboxId` 的话主区会停在"选择左侧项目"空态，任务行看起来是死的。
   *
   * MUTATION：`onSelectTask` 里去掉 `setSelectedProjectId(owner.projectId)` → 本条红。
   */
  it('点任务行 ⇒ 同时定位到它所属项目（否则主区打不开）', async () => {
    mockProjects([
      projectDto({ id: 'p1', name: 'ProjectA', taskCount: 0 }),
      projectDto({ id: 'p2', name: 'ProjectB', taskCount: 1 }),
    ]);
    mockSandboxes([
      {
        id: 'sbx-2',
        projectId: 'p2',
        runtime: 'codex',
        provider: 'aio',
        name: 'B 的任务',
        status: 'running',
        headless: false,
        timeoutMinutes: null,
        idleTimeoutSec: 1800,
        waitingInput: false,
        version: 0,
      },
    ]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /B 的任务/ }));
    // 只读条只在选中项目时渲染 ⇒ 它出现即证明项目被一起定位了。
    const bar = await screen.findByTestId('project-info-bar');
    expect(within(bar).getByText(/ProjectB/)).toBeInTheDocument();
  });

  it('后端返回空 ⇒ 保持空态引导（不因为接了列表就误报有任务）', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA', taskCount: 0 })]);
    mockSandboxes([]);
    renderWorkbench();

    await screen.findByRole('button', { name: /ProjectA/ });
    expect(screen.queryByRole('button', { name: /分析这个仓库/ })).not.toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────────────────
// WS 基址：同源（shared/11 §1.3）
//
// ⚠️ 这一条盯的是 `WorkbenchContainer` 里那个模块级默认值本身。在补它之前，把默认值
// 从 `''` 改回 `'ws://localhost:3001'`，**1001 条测试一条都不红** —— 那个绝对地址就是
// 这么被烤进生产 bundle 的（实测在 `chunks/app/page-*.js`，不是 mock 残留）。
//
// 为什么绝对地址在这里无解：它是**构建期**常量，而正确值取决于**运行时**访问者用的
// host。烤 `ws://localhost:3100`，同事从局域网打开时它就去连同事自己机器的 3100。
// 空串 ⇒ socket.io 按相对路径解析，补当前页面的 host 与协议（https 自动 wss），
// 再由 next.config.mjs 的 `/socket.io` rewrite 转给后端。
// ────────────────────────────────────────────────────────────────────────
describe('WS 基址', () => {
  it('默认走同源：传给 /events 通道的 base 是空串，不是任何绝对地址', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA', taskCount: 0 })]);
    mockSandboxes([]);
    renderWorkbench();
    await screen.findByRole('button', { name: /ProjectA/ });

    expect(eventsSocket.lastBase).toBe('');
    // ⚠️ 分开断言：上一句在默认值是 `ws://…` 时会红，但如果哪天有人改成别的
    // 非空字面量（比如 '/'），只看 toBe('') 说不出「问题是它绝对了」。
    expect(eventsSocket.lastBase).not.toMatch(/^wss?:\/\//);
  });
});
