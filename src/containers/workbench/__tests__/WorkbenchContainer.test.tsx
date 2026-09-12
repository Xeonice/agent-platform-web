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
import { NewTaskDeepLinkContainer } from '@/containers/sandbox/NewTaskDeepLinkContainer';
import { healthKeys } from '@/hooks/_shared/useHealth';
import { useAppStore } from '@/stores';
import type { ProjectDto } from '@/types/project';
import type { InitStatusDto } from '@/types/system';

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

/**
 * 组头「⋯」→ [项目菜单…] → 侧弹层（F21-6 §10）。
 *
 * ⚠️ 这条路本轮才存在：在它之前组头是一个纯按钮，删除项目 / 已保留卷 / 自动化
 * 三个入口要么没有、要么借挂在项目只读条上（§10.1 / §10.2 C）。
 */
function groupHeaderOf(projectName: string): HTMLElement {
  const header = screen
    .getAllByTestId('project-group-header')
    .find((el) => el.textContent.includes(projectName));
  if (header === undefined) throw new Error(`找不到项目组头：${projectName}`);
  return header;
}

/** 组头「⋯」→ 下拉菜单。 */
async function openGroupMenu(projectName: string): Promise<HTMLElement> {
  await screen.findAllByTestId('project-group-header');
  fireEvent.click(within(groupHeaderOf(projectName)).getByTestId('project-group-menu-trigger'));
  return screen.findByTestId('project-group-menu');
}

/** 组头「⋯」→ [项目菜单…] → 侧弹层。 */
async function openProjectMenu(projectName: string): Promise<HTMLElement> {
  const menu = await openGroupMenu(projectName);
  fireEvent.click(within(menu).getByTestId('group-menu-open-panel'));
  return screen.findByTestId('modal-project-menu');
}

beforeEach(() => {
  cleanup();
  nav.push.mockClear();
  useAppStore.getState().setSelectedProjectId(null);
  useAppStore.getState().setSelectedSandboxId(null);
  useAppStore.getState().setCurrentModal(null);
  useAppStore.getState().setSelectedProjectForMenu(null);
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
// ————————————————————————————————————————————————————————————————
// ⭐ 「[+ 新任务]」与 `/new` 深链打开**同一个**弹层（design-notes.md §4 Phase 3 第 5 条）：
// 两条路径都只是把 store 上的 `currentModal` 置成 `'newTask'`——落地渲染的是
// `SandboxTerminalContainer` 里**同一处** JSX，不是深链专门另画一份。
// ————————————————————————————————————————————————————————————————
describe('WorkbenchContainer · [+ 新任务] 与 /new 深链是同一个弹层', () => {
  afterEach(() => {
    // jsdom 的 `window.location` 跨用例持续存在，不清掉会让后面的用例平白带着
    // `?new=1&project=p1` 启动。
    window.history.replaceState(null, '', '/');
  });

  /**
   * ⭐⭐ **核心断言**：深链打开一次、关掉，再站内点开一次——两次落地的必须是
   * 同一个 `data-testid="modal-new-task"`（标题/副标题一字不差），且任意时刻
   * 都只有一份（`getAllByTestId` 长度恒为 1），⛔ 不是深链专属渲染一份、
   * 按钮点开另渲染一份长得像的。
   *
   * 变异：把 `NewTaskDeepLinkContainer` 消费深链后改成 set 一个不同的 modal key
   * （比如 `'newTaskFromLink'`）并在 `WorkbenchContainer`/`SandboxTerminalContainer`
   * 里另开一个分支渲染"看起来一样"的弹层 ⇒ 深链那次的 `currentModal` 断言与
   * "同一个 modal-new-task" 的字符串比较都会变红。
   */
  it('⭐⭐ 深链打开与站内点击打开落地同一个 modal-new-task', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    window.history.pushState(null, '', '/?new=1&project=p1');

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    render(
      <>
        <NewTaskDeepLinkContainer />
        <WorkbenchContainer />
      </>,
      { wrapper: Wrapper },
    );

    // ① 深链直接打开。
    const deepLinkModal = await screen.findByTestId('modal-new-task');
    expect(screen.getAllByTestId('modal-new-task')).toHaveLength(1);
    expect(useAppStore.getState().currentModal).toBe('newTask');
    expect(within(deepLinkModal).getByText('在「ProjectA」中发起')).toBeInTheDocument();

    // 关掉这一份。
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('modal-new-task')).not.toBeInTheDocument();
    });
    expect(useAppStore.getState().currentModal).toBeNull();

    // ② 同一个项目，改走站内点击 [+ 新任务]。
    fireEvent.click(screen.getByRole('button', { name: /新任务/ }));
    const clickModal = await screen.findByTestId('modal-new-task');
    expect(screen.getAllByTestId('modal-new-task')).toHaveLength(1);
    expect(useAppStore.getState().currentModal).toBe('newTask');
    // 同一个标题、同一句副标题——不是"深链版"与"点击版"两份长得像但各自独立的渲染。
    expect(within(clickModal).getByText('新建任务')).toBeInTheDocument();
    expect(within(clickModal).getByText('在「ProjectA」中发起')).toBeInTheDocument();
  });
});

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

  /**
   * ⚠️ **本例在 Phase 3 被改写，不是删掉**（design-notes.md §4 Phase 3 第 5 条）：
   * 「新建任务」弹层这一轮换成了 shadcn `Dialog`（Radix），「新建项目」维持原有的
   * `ModalShellView` 手写实现——两者不再共用同一套 class 字符串是**刻意的、已记录的
   * 偏离**，不是谁改坏了谁。"形态对称"这条纪律改为在**语义**层面钉住（真 overlay、
   * role=dialog、aria-modal、Esc 都能关），不再钉字面 className——后者绑定了"两个弹层
   * 必须是同一份手写实现"这个已经不成立的前提。
   *
   * 变异：把「新建任务」的 `DialogPrimitive.Content` 上的 `data-testid`/`role` 拿掉
   * ⇒ 下面 `toHaveAttribute('role', 'dialog')` 那句变红；把 Esc 处理去掉 ⇒ 最后的
   * `waitFor` 超时。
   */
  it('两个弹层都是真 overlay（role=dialog + aria-modal），Esc 都能关（新建任务本轮换用 shadcn Dialog，与新建项目不再共用同一份手写外壳）', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /新建项目/ }));
    const projectModal = await screen.findByTestId('modal-new-project');
    expect(projectModal).toHaveAttribute('role', 'dialog');
    expect(projectModal).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('modal-new-project')).not.toBeInTheDocument();
    });

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /新任务/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /新任务/ }));
    const taskModal = await screen.findByTestId('modal-new-task');
    expect(taskModal).toHaveAttribute('role', 'dialog');
    expect(taskModal).toHaveAttribute('aria-modal', 'true');

    // Esc 派给 `document`：Radix 的 `DismissableLayer` 监听 `ownerDocument`（捕获阶段），
    // 与旧版 `window` 监听同属"抢在 xterm stopPropagation 之前"这条纪律，但合成事件要
    // 落在 document 的事件路径上才收得到（真实按键天然如此，见 `SandboxTerminalContainer.test.tsx`
    // 同一处注释）。
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('modal-new-task')).not.toBeInTheDocument();
    });
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
// ⑤ 🎁 已保留卷（F21-6 §3.3）—— ★ 2026-09-01 入口**已从只读条搬进项目菜单**（§10.2 C）
// ————————————————————————————————————————————————————————————————
describe('WorkbenchContainer · 已保留卷入口', () => {
  /**
   * 入口 + 弹层一起验：`currentModal` 的取值只有"set 与 read 一起落地"才算数
   * （createUiSlice 文件头那条纪律——只在类型里存在的取值比没有更坏）。
   *
   * ★ 本轮改了**入口位置**：组头「⋯」→ [项目菜单…] → [🎁 已保留卷]（§10.7 集成 ⑥）。
   * 变异：把 `ProjectMenuPanel.view` 的 [🎁 已保留卷] 按钮删掉、或把 `overlaySlot` 里
   * `retainedVolumes` 那个分支去掉 ⇒ 本例变红。
   */
  it('组头「⋯」→ 项目菜单里有 [🎁 已保留卷]，点开是 overlay 弹层', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    server.use(http.get(`${API_BASE}/api/retained-volumes`, () => HttpResponse.json([])));
    renderWorkbench();

    const panel = await openProjectMenu('ProjectA');
    fireEvent.click(within(panel).getByTestId('open-retained-volumes'));

    const modal = await screen.findByTestId('modal-retained-volumes');
    expect(modal).toHaveAttribute('role', 'dialog');
    expect(modal).toHaveAttribute('aria-modal', 'true');
    expect(within(modal).getByTestId('retained-volumes-panel')).toBeInTheDocument();
  });

  /**
   * ⭐ 否定性搬家断言：只读条**回到纯只读**——那两个入口不许再出现在它上面（§10.4 判据 2）。
   * 变异：把 `ProjectInfoBar.view` 的按钮加回去 ⇒ 本例变红。
   */
  it('项目只读条上不再有 [🎁 已保留卷] / [⚙️ 自动化规则]（回到纯只读）', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    const bar = await screen.findByTestId('project-info-bar');
    expect(within(bar).queryByTestId('open-retained-volumes')).not.toBeInTheDocument();
    expect(within(bar).queryByTestId('open-automations')).not.toBeInTheDocument();
  });

  /** 打得开就必须关得掉：这个弹层里全是链接与按钮，键盘用户会被困住。 */
  it('Esc 关闭已保留卷弹层', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    server.use(http.get(`${API_BASE}/api/retained-volumes`, () => HttpResponse.json([])));
    renderWorkbench();

    const panel = await openProjectMenu('ProjectA');
    fireEvent.click(within(panel).getByTestId('open-retained-volumes'));
    await screen.findByTestId('modal-retained-volumes');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('modal-retained-volumes')).not.toBeInTheDocument();
    });
  });

  /**
   * ⭐ 否定性：**菜单没打开时不该有这个入口**——保留卷是按项目过滤的
   * （`GET /api/retained-volumes?projectId=`），没有项目就没有可问的问题。
   */
  it('未打开项目菜单 ⇒ 入口不存在', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    renderWorkbench();

    await screen.findByRole('button', { name: /ProjectA/ });
    expect(screen.queryByTestId('project-info-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('open-retained-volumes')).not.toBeInTheDocument();
  });

  /** 弹层同一时刻只有一个（modal 不堆叠，F21-6 §2）：换值 ⇒ 项目菜单随之关闭。 */
  it('开着已保留卷时，项目菜单与新建项目弹层都不在场', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    server.use(http.get(`${API_BASE}/api/retained-volumes`, () => HttpResponse.json([])));
    renderWorkbench();

    const panel = await openProjectMenu('ProjectA');
    fireEvent.click(within(panel).getByTestId('open-retained-volumes'));
    await screen.findByTestId('modal-retained-volumes');
    expect(screen.queryByTestId('modal-project-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('modal-new-project')).not.toBeInTheDocument();
  });
});

// ————————————————————————————————————————————————————————————————
// ④ 项目只读条 + [重新同步]（F21-6 §9.2/§9.3）
// ————————————————————————————————————————————————————————————————
describe('WorkbenchContainer · 项目只读条', () => {
  it('选中项目 ⇒ 主区顶部四格（仓库/分支/代码体积/最后拉取），不新开页面', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    const bar = await screen.findByTestId('project-info-bar');
    expect(within(bar).getByText('https://github.com/acme/acme-web.git')).toBeInTheDocument();
    expect(within(bar).getByText('develop')).toBeInTheDocument();
    expect(within(bar).getByText('45 MB')).toBeInTheDocument();
    // ⚠️ 屏上用词：内部叫「远端/基线/同步」，界面上是「仓库/代码体积/拉取最新代码」。
    //    「同步」尤其要避开——它双向暧昧，而这条路只拉不推。
    expect(within(bar).getByText('仓库')).toBeInTheDocument();
    expect(within(bar).getByText('代码体积')).toBeInTheDocument();
    expect(within(bar).getByText('最后拉取')).toBeInTheDocument();
    expect(bar.textContent).not.toContain('基线');
    // 只读：这条上不该出现改远端 / 切默认分支 / 重新 clone 之类的入口（§9.2）。
    expect(within(bar).queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      within(bar).queryByRole('button', { name: /重新克隆|修改远端/ }),
    ).not.toBeInTheDocument();
  });

  it('[拉取最新代码] → POST /api/projects/:id/sync（唯一的动作）', async () => {
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
    const button = await screen.findByTestId('project-sync');
    // ★ 这一句是文案层就能补的那半个缺口（§9.3 原注释把它整条记成了"有意识留下的缺口"）：
    //   拉取只更新项目里的这份代码，已经建好的任务不会跟着变 —— 要在**按下之前**看得到。
    expect(button).toHaveAttribute('title', expect.stringContaining('已经建好的任务'));
    fireEvent.click(button);
    await waitFor(() => {
      expect(hit).toBe(1);
    });
  });

  /**
   * **仅 ready 态**给 [重新同步]（§9.3）。
   * 变异：把 `canSync` 改成恒真 ⇒ 本例变红。
   */
  it('克隆中/失败的项目 ⇒ 不给 [拉取最新代码]', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA', cloneStatus: 'cloning' })]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    await screen.findByTestId('project-info-bar');
    expect(screen.queryByTestId('project-sync')).not.toBeInTheDocument();
  });

  it('空项目 ⇒ 整条降级为「空项目（没有关联仓库）」，时间格显示创建时间', async () => {
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
    expect(within(bar).getByText(/空项目（没有关联仓库）/)).toBeInTheDocument();
    expect(within(bar).getByText('创建于')).toBeInTheDocument();
    expect(within(bar).queryByTestId('project-sync')).not.toBeInTheDocument();
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

    // 任务行真的渲染出来了——而不是"发起第一个任务 →"的空态。
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

  /**
   * ⭐ **空组那句「发起第一个任务 →」必须是可点的**（2026-09-11 修）。
   *
   * 它此前是个 `<p>`，却带着一个 `→` —— 箭头是"这里能点"的承诺，而它点不动。
   * 用户点上去没有任何反应，比不给这句话更糟。
   *
   * MUTATION：把 `WorkbenchShell.view` 里那个 `<button>` 改回 `<p>` ⇒ 本条第一句
   * `getByRole('button', …)` 当场找不到元素。
   */
  it('⭐ 空组的「发起第一个任务 →」是按钮，点它就打开新建任务弹层（不是一段点不动的字）', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA', taskCount: 0 })]);
    mockSandboxes([]);
    renderWorkbench();

    const cta = await screen.findByRole('button', { name: /发起第一个任务/ });
    fireEvent.click(cta);

    // 点它 = 选中这个项目 + 开弹层（弹窗里没有项目下拉，归属继承选中项）。
    expect(await screen.findByTestId('modal-new-task')).toBeInTheDocument();
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
// ————————————————————————————————————————————————————————————————
// 顶栏健康提示：正常时不渲染（design-notes.md §1 问题 5 / §4 Phase 3 第 4 条）
// ————————————————————————————————————————————————————————————————
describe('顶栏健康提示（正常时不渲染，异常时才挂载）', () => {
  /**
   * ⭐ 覆盖**切换**，不是两个静态态：先异常（挂载）再恢复正常（卸载）。
   * 只测两个独立渲染的静态 story/用例测不出"切换"这件事本身——`healthLabel` 有可能是
   * 一个只在初次渲染算一次、之后再也不更新的死值，两个孤立的静态断言看不出这个缺陷。
   *
   * 变异：把 `healthLabel = health.isError ? '后端不可用' : null` 改成
   * `health.data !== undefined ? '后端健康...' : ...`（抄回旧逻辑）⇒ 本例第一句
   * （异常时挂载）不受影响，但如果同时把 `null` 分支去掉、常驻渲染一个空字符串，
   * 第二句（恢复后卸载）会变红——`queryByTestId` 会找到一个内容是空字符串的节点。
   */
  it('⭐ 后端不可用 ⇒ 顶栏挂载红字；恢复正常后 ⇒ 该节点整个卸载', async () => {
    mockProjects([]);
    server.use(
      http.get(`${API_BASE}/api/health`, () =>
        HttpResponse.json({ code: 'INTERNAL', message: '挂了', retryable: true }, { status: 500 }),
      ),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    render(<WorkbenchContainer />, { wrapper: Wrapper });

    const label = await screen.findByTestId('health-label');
    expect(label).toHaveTextContent('后端不可用');

    // 后端恢复：替身改回默认成功响应，主动使 health 查询失效触发重新取数。
    server.resetHandlers();
    await client.invalidateQueries({ queryKey: healthKeys.all() });

    await waitFor(() => {
      expect(screen.queryByTestId('health-label')).not.toBeInTheDocument();
    });
  });

  it('正常（health 请求成功）⇒ 从一开始就不挂载', async () => {
    mockProjects([]);
    renderWorkbench();
    await screen.findByLabelText('项目分组任务树');
    expect(screen.queryByTestId('health-label')).not.toBeInTheDocument();
  });
});

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

// ————————————————————————————————————————————————————————————————
// ⑤ 离线模式的跨页影响（F21-8 §4 / §9.1 #16、#17 / P21-8 §7 置灰清单）
// ————————————————————————————————————————————————————————————————
describe('WorkbenchContainer · 离线模式下的 [+ 新任务]', () => {
  const OFFLINE_STATUS: InitStatusDto = {
    initialized: true,
    lastConnectivityCheck: [
      { target: 'api.openai.com', ok: false, hint: '连接超时', modelApi: true },
      { target: 'api.anthropic.com', ok: false, hint: '连接超时', modelApi: true },
      // ⚠️ 镜像仓库通着 —— 离线判定只看模型 API 那一半。
      { target: 'ghcr.io', ok: true, latencyMs: 6, modelApi: false },
    ],
    lastConnectivityCheckAt: '2026-08-29T16:11:34.000Z',
  };

  function mockInitStatus(body: InitStatusDto): void {
    server.use(http.get(`${API_BASE}/api/system/init-status`, () => HttpResponse.json(body)));
  }

  /**
   * ⭐ 判定与 🔴 横幅**同源**（`useOfflineMode`）。分成两份各算各的时，界面上会出现
   * "红条说 Agent 不可用、而 [+ 新任务] 照样能点" —— 用户点进去、填完指令，在最后一步才撞墙。
   *
   * 变异：把 `newTaskDisabledReason` 里的 `offline.disabledReason ??` 去掉 ⇒ 本例红。
   */
  it('⭐ 离线且项目已就绪 ⇒ 入口仍然置灰，且给出离线那句话', async () => {
    mockInitStatus(OFFLINE_STATUS);
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    mockSandboxes([]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /新任务/ })).toBeDisabled();
    });
    const entry = screen.getByRole('button', { name: /新任务/ });
    expect(entry).toHaveAttribute('title', '离线模式：需连接网络才能发起任务');
    // ⛔ **只置灰不隐藏**（P21-8 §7）：配好网络后不该需要重装才能重新看到入口。
    expect(entry).toBeInTheDocument();
  });

  /**
   * ⭐ 离线的理由**排在"先选中项目"之前**：换哪个项目都发不出去，
   * 让用户照着"先选中一个项目"去点、点完发现还是灰的，是把他支使了一趟。
   */
  it('⭐ 离线 + 未选中项目 ⇒ 说的是离线，不是「先在左侧选中一个项目」', async () => {
    mockInitStatus(OFFLINE_STATUS);
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    mockSandboxes([]);
    renderWorkbench();

    const entry = await screen.findByRole('button', { name: /新任务/ });
    await waitFor(() => {
      expect(entry).toHaveAttribute('title', '离线模式：需连接网络才能发起任务');
    });
  });

  /**
   * ⭐ 否定断言：**只有模型 API 全挂才算离线**。只有镜像仓库不可达时 Agent 一直好好的，
   * 把它也算进去会让一台内网镜像站没配好的机器彻底发不出任务。
   *
   * 变异：把 `connectivityVerdict` 里 `filter(r => r.modelApi)` 去掉 ⇒ 本例红。
   */
  it('⭐ 只有镜像仓库不可达（partial）⇒ 入口照常可点', async () => {
    mockInitStatus({
      ...OFFLINE_STATUS,
      lastConnectivityCheck: [
        { target: 'api.openai.com', ok: true, latencyMs: 351, modelApi: true },
        { target: 'api.anthropic.com', ok: true, latencyMs: 1925, modelApi: true },
        { target: 'ghcr.io', ok: false, hint: '内网镜像站未配置', modelApi: false },
      ],
    });
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    mockSandboxes([]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /新任务/ })).toBeEnabled();
    });
  });

  /**
   * ⭐ `init-status` 读不到时 ⛔ **不许**把入口置灰成"离线模式"——那是一句更好看的谎：
   * 真正的原因是后端没起来（横幅那边会如实说），而这里若报"需连接网络"，
   * 用户会去查一个没有问题的网络。判定缺席 ⇒ 回落到既有的两条理由。
   */
  it('⭐ `init-status` 500 ⇒ 入口**不因离线而置灰**（选中就绪项目后照常可点）', async () => {
    server.use(
      http.get(`${API_BASE}/api/system/init-status`, () =>
        HttpResponse.json({ code: 'INTERNAL', message: '炸了', retryable: true }, { status: 500 }),
      ),
    );
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    mockSandboxes([]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /新任务/ })).toBeEnabled();
    });
  });
});

// ————————————————————————————————————————————————————————————————
// ⑥ 项目菜单整块（F21-6 §10）：组头「⋯」→ 菜单 → 侧弹层 → 删除
//
// 这一节存在的理由不是"多几条用例"：`DELETE /api/projects/:id` 端点一直都在、级联语义
// 早就定义好了，而在此之前用户**在界面上够不着**——唯一的删除途径是自己拼 URL 打 API
// （§10.1）。下面每一条都对着 §10.7 的一行。
// ————————————————————————————————————————————————————————————————
describe('WorkbenchContainer · 项目菜单与删除', () => {
  /** ① 组头「⋯」→ 菜单打开。变异：把 `ProjectGroupHeader.view` 的 ⋯ 按钮删掉 ⇒ 红。 */
  it('组头「⋯」打开下拉菜单；[项目菜单…] 打开侧弹层（overlay）', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA', taskCount: 5 })]);
    mockSandboxes([]);
    renderWorkbench();

    const panel = await openProjectMenu('ProjectA');
    expect(panel).toHaveAttribute('role', 'dialog');
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(within(panel).getByTestId('project-meta-section')).toHaveTextContent('ProjectA');
  });

  /**
   * ⭐ §9.2 VS-2 步骤 1 / §7.3「组头菜单不改上下文」：
   * 当前项目为 A，点 B 的「⋯」→ `selectedProjectForMenu==='p2'` 且 `selectedProjectId` 仍是 'p1'。
   *
   * 变异：把 `handleOpenProjectMenu` 里改成顺手 `setSelectedProjectId(projectId)` ⇒ 本例变红。
   */
  it('打开 B 的项目菜单 ⇒ 当前工作项目仍是 A（两位语义分离）', async () => {
    mockProjects([
      projectDto({ id: 'p1', name: 'ProjectA' }),
      projectDto({ id: 'p2', name: 'ProjectB' }),
    ]);
    mockSandboxes([]);
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    await waitFor(() => {
      expect(useAppStore.getState().selectedProjectId).toBe('p1');
    });

    await openProjectMenu('ProjectB');
    expect(useAppStore.getState().selectedProjectForMenu).toBe('p2');
    expect(useAppStore.getState().selectedProjectId).toBe('p1');
  });

  /**
   * ⭐ §10.6 第 3 条：运行中任务警示读**真数据**（沙箱列表实际状态），
   * 0 与 2 必须长得不一样。变异：把 `DeleteProjectConfirm` 那两个分支合成一句
   *「可能有正在运行的任务」⇒ 本例与下一例同时变红。
   */
  it('[删除] → 二次确认：级联句 + 运行中任务数（读沙箱真实状态）', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA', taskCount: 5 })]);
    mockSandboxes([
      { id: 's1', projectId: 'p1', name: 'T1', status: 'running', waitingInput: false },
      { id: 's2', projectId: 'p1', name: 'T2', status: 'idle', waitingInput: true },
      { id: 's3', projectId: 'p1', name: 'T3', status: 'stopped', waitingInput: false },
      // 别的项目的运行中任务**不许**被算进来。
      { id: 's4', projectId: 'p2', name: 'T4', status: 'running', waitingInput: false },
    ]);
    renderWorkbench();

    const panel = await openProjectMenu('ProjectA');
    fireEvent.click(within(panel).getByTestId('project-delete-entry'));

    /**
     * ★ **三行，一条都不许省**（旧文案是一句话，把最重要的「留了什么」塞进了括号，
     *   而且**一个字都没说远端 Git 仓库不受影响** —— 那是开发者按下去之前最想知道的
     *   第一件事）。这三条断言分别钉住：删什么 / 留什么 / 能不能反悔。
     */
    const cascade = await screen.findByTestId('delete-cascade-copy');
    expect(cascade).toHaveTextContent('会删掉');
    expect(cascade).toHaveTextContent('5 个任务');
    expect(cascade).toHaveTextContent('会留下');
    expect(cascade).toHaveTextContent('远端 Git 仓库不受影响');
    expect(cascade).toHaveTextContent('删掉之后');
    expect(cascade).toHaveTextContent('拿不回来');
    // ⛔ 界面上别处没有的词（「成果卷」「数据卷」）不许在这里出现。
    expect(cascade.textContent).not.toContain('成果卷');
    expect(cascade.textContent).not.toContain('数据卷');

    expect(screen.getByTestId('delete-running-warning')).toHaveTextContent(
      '其中 2 个任务正在跑，会被强制停下',
    );
  });

  it('没有运行中任务 ⇒ 明说「当前没有运行中的任务」，而不是沉默', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA', taskCount: 1 })]);
    mockSandboxes([
      { id: 's3', projectId: 'p1', name: 'T3', status: 'stopped', waitingInput: false },
    ]);
    renderWorkbench();

    const panel = await openProjectMenu('ProjectA');
    fireEvent.click(within(panel).getByTestId('project-delete-entry'));
    expect(await screen.findByTestId('delete-running-warning')).toHaveTextContent(
      '当前没有运行中的任务',
    );
  });

  /** ② [删除] → 确认 → 真的发出 `DELETE /api/projects/:id`。 */
  it('确认 ⇒ 发出 DELETE /api/projects/:id 并关闭弹层', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    mockSandboxes([]);
    const deleted: string[] = [];
    server.use(
      http.delete(`${API_BASE}/api/projects/:id`, ({ params }) => {
        deleted.push(String(params['id']));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWorkbench();

    const panel = await openProjectMenu('ProjectA');
    fireEvent.click(within(panel).getByTestId('project-delete-entry'));
    fireEvent.click(await screen.findByTestId('delete-confirm'));

    await waitFor(() => {
      expect(deleted).toEqual(['p1']);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('modal-project-menu')).not.toBeInTheDocument();
    });
  });

  /**
   * ⭐ §10.7 集成 ③ / 变异点之一：**409 不许被处理成静默关闭**。
   * 变异：把 `ProjectMenuContainer` 的 `onError` 改成 `onDeleted(projectId)`（即关掉弹层）
   * ⇒ 本例变红（弹层不在了、原因也没人说）。
   */
  it('后端 409（有运行中任务）⇒ 弹层留在原地并显示原因，⛔ 不静默关闭', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA', taskCount: 2 })]);
    mockSandboxes([
      { id: 's1', projectId: 'p1', name: 'T1', status: 'running', waitingInput: false },
    ]);
    server.use(
      http.delete(`${API_BASE}/api/projects/:id`, () =>
        HttpResponse.json(
          {
            code: 'CONFLICT',
            message: '该项目仍有运行中的任务，请先停止后再删除。',
            retryable: false,
          },
          { status: 409 },
        ),
      ),
    );
    renderWorkbench();

    const panel = await openProjectMenu('ProjectA');
    fireEvent.click(within(panel).getByTestId('project-delete-entry'));
    fireEvent.click(await screen.findByTestId('delete-confirm'));

    // ⚠️ 按码查人话表：`CONFLICT` 不在表里 ⇒ 走兜底；⛔ 后端 message 不上屏。
    expect(await screen.findByTestId('delete-error')).toHaveTextContent('删除失败，请稍后重试。');
    expect(screen.getByTestId('modal-project-menu')).toBeInTheDocument();
    // 本地状态没被"乐观"改动：树里那一项还在。
    expect(screen.getAllByTestId('project-group-header')).toHaveLength(1);
  });

  /**
   * ⭐ §10.6 第 1 条 / 变异点之二：**删除当前选中项目 ⇒ 选中态清空、主区回引导态**。
   * ⛔ 不许留一个指向已删项目的 `selectedProjectId`（它是 persist 的）。
   *
   * 变异：把 `useDeleteProject` 里清选中的分支删掉 ⇒ 本例变红。
   */
  it('删除当前选中项目 ⇒ 选中态清空、主区回引导态（不是白屏）', async () => {
    let projects = [
      projectDto({ id: 'p1', name: 'ProjectA' }),
      projectDto({ id: 'p2', name: 'ProjectB' }),
    ];
    server.use(http.get(`${API_BASE}/api/projects`, () => HttpResponse.json(projects)));
    mockSandboxes([]);
    server.use(
      http.delete(`${API_BASE}/api/projects/:id`, ({ params }) => {
        projects = projects.filter((p) => p.id !== String(params['id']));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    await waitFor(() => {
      expect(useAppStore.getState().selectedProjectId).toBe('p1');
    });

    const panel = await openProjectMenu('ProjectA');
    fireEvent.click(within(panel).getByTestId('project-delete-entry'));
    fireEvent.click(await screen.findByTestId('delete-confirm'));

    await waitFor(() => {
      expect(useAppStore.getState().selectedProjectId).toBeNull();
    });
    expect(useAppStore.getState().selectedSandboxId).toBeNull();
    expect(await screen.findByText('选择左侧项目，或新建一个项目开始。')).toBeInTheDocument();
  });

  /**
   * ⭐ §10.7 集成 ⑤ / 变异点之三：failed 态菜单 [重试克隆] 与恢复面板 [重试]
   * **命中同一个 hook** —— 断言只发一次 `retry-clone`。
   *
   * 变异：让 `ProjectGroupMenuView` 的 `onRetryClone` 自己再发一次 `retry-clone`
   *（"两份实现"那个病）⇒ 请求数变 2，本例变红。
   */
  it('failed 组头菜单 [重试克隆] 只发一次 retry-clone（与恢复面板同一个 hook）', async () => {
    mockProjects([
      projectDto({ id: 'p1', name: 'FailedProject', cloneStatus: 'failed', taskCount: 0 }),
    ]);
    mockSandboxes([]);
    let retryCount = 0;
    server.use(
      http.post(`${API_BASE}/api/projects/:id/retry-clone`, ({ params }) => {
        retryCount += 1;
        return HttpResponse.json(
          projectDto({ id: String(params['id']), name: 'FailedProject', cloneStatus: 'cloning' }),
          { status: 202 },
        );
      }),
    );
    renderWorkbench();

    const menu = await openGroupMenu('FailedProject');
    fireEvent.click(within(menu).getByTestId('group-menu-retry-clone'));

    await waitFor(() => {
      expect(retryCount).toBe(1);
    });
    // 再等一拍，确认没有第二处实现补发。
    await waitFor(() => {
      expect(retryCount).toBe(1);
    });
  });

  /**
   * §10.6 第 2 条：cloning 态菜单里 [取消克隆（保留项目）] 与 [删除项目…] **分开且文案不像**。
   * 变异：把取消项去掉、或把它的文案改成「删除克隆」⇒ 本例变红。
   */
  it('cloning 项目：取消克隆与删除是两项，文案不像', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'CloningProject', cloneStatus: 'cloning' })]);
    mockSandboxes([]);
    let cancelled = 0;
    server.use(
      http.post(`${API_BASE}/api/projects/:id/cancel-clone`, ({ params }) => {
        cancelled += 1;
        return HttpResponse.json(
          projectDto({ id: String(params['id']), name: 'CloningProject', cloneStatus: 'failed' }),
        );
      }),
    );
    renderWorkbench();

    const menu = await openGroupMenu('CloningProject');
    expect(within(menu).getByTestId('group-menu-cancel-clone')).toHaveTextContent(
      '取消克隆（保留项目）',
    );
    expect(within(menu).getByTestId('group-menu-delete')).toHaveTextContent('删除项目…');

    fireEvent.click(within(menu).getByTestId('group-menu-cancel-clone'));
    await waitFor(() => {
      expect(cancelled).toBe(1);
    });
  });

  /** cloning 态的删除确认要说清「先取消克隆」（§10.6 第 2 条）。 */
  it('cloning 项目的删除确认含「先取消克隆」，并指向另一条路', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'CloningProject', cloneStatus: 'cloning' })]);
    mockSandboxes([]);
    renderWorkbench();

    const menu = await openGroupMenu('CloningProject');
    fireEvent.click(within(menu).getByTestId('group-menu-delete'));

    const note = await screen.findByTestId('delete-cloning-note');
    expect(note).toHaveTextContent('先停掉这次克隆');
    expect(note).toHaveTextContent('取消克隆（保留项目）');
  });

  /**
   * ★ **[改为空项目] 是不可逆动作，此前界面一个字都没说它留下什么。**
   *
   * 产品 §6 定得很清楚：项目 ID 留、已关联任务留，只是工作区变空。不说，用户按之前
   * 只知道"要改成空的"，不知道会不会连任务一起弄丢 —— 要么不敢按（这条出路等于没有），
   * 要么按了之后去找一个并不存在的损失。
   *
   * ⚠️ 「改完还能不能变回 git 项目」这一句**刻意没写**（产品文档没裁过，而代码上
   *   retry-clone 只允许 failed 态、改完是 ready ⇒ 事实上回不去）。这条断言同时钉住
   *   那句话**不许被顺手补上** —— 写死"不可逆"是替产品下裁决，写"以后可以"是撒谎。
   */
  it('failed 项目的组菜单说清 [改为空项目] 留下什么，且不擅自裁决"能不能改回来"', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'FailedProject', cloneStatus: 'failed' })]);
    mockSandboxes([]);
    renderWorkbench();

    const menu = await openGroupMenu('FailedProject');
    const text = menu.textContent;
    expect(text).toContain('项目和它下面已有的任务都留着');
    expect(text).toContain('工作区从空的开始');
    // ⛔ 未裁决的事不许写死。
    expect(text).not.toContain('不可逆');
    expect(text).not.toContain('改回');
  });

  /**
   * ★ **failed 态的项目菜单此前是一条死路**：只写「状态：克隆失败」，同面板只有
   *   [删除项目…]，而 [重试克隆] / [改为空项目] 在**另一个**菜单里。用户看到的是
   *   "这个项目挂了，我只能删掉它"。⛔ 补的是指路，不是第二个入口（全仓只许有一处
   *   持有 retry-clone）。
   */
  it('failed 项目的项目菜单不是死路：指出两条出路在哪个菜单里', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'FailedProject', cloneStatus: 'failed' })]);
    mockSandboxes([]);
    renderWorkbench();

    const panel = await openProjectMenu('FailedProject');
    const hint = within(panel).getByTestId('project-meta-failed-hint');
    expect(hint).toHaveTextContent('重试克隆');
    expect(hint).toHaveTextContent('改为空项目');
    expect(hint).toHaveTextContent('「⋯」菜单');
    // ⛔ 指路不等于搬入口：面板里仍然只有删除那一个动作。
    expect(within(panel).queryByTestId('group-menu-retry-clone')).toBeNull();
  });

  /** 顶部指示器：只读 + 定位，⛔ 没有下拉（§9.1 #2 否定性验收）。 */
  it('顶部指示器显示当前项目名，点击只做树内定位展开', async () => {
    mockProjects([projectDto({ id: 'p1', name: 'ProjectA' })]);
    mockSandboxes([]);
    renderWorkbench();

    expect(await screen.findByTestId('current-project-indicator')).toHaveTextContent('未选择项目');
    fireEvent.click(await screen.findByRole('button', { name: /ProjectA/ }));
    expect(await screen.findByTestId('current-project-indicator')).toHaveTextContent('ProjectA');

    useAppStore.getState().toggleProjectFold('p1');
    fireEvent.click(screen.getByTestId('locate-current-project'));
    expect(useAppStore.getState().taskListFolds['p1']).toBe(false);
    expect(useAppStore.getState().selectedProjectId).toBe('p1');
  });
});
