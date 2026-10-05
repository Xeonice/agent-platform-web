import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { API, NOW, project, sandbox, runtime, resources } from './support/fixtures';
import { server } from './support/server';
import { mount } from './support/mount';
import { AppFrameContainer } from '@/containers/workbench/AppFrameContainer';
import { WorkbenchContainer } from '@/containers/workbench/WorkbenchContainer';
import { CommandPaletteContainer } from '@/containers/workbench/CommandPaletteContainer';
import { AppBootGate } from '@/containers/init/AppBootGate';
import { GlobalBannerContainer } from '@/containers/banner/GlobalBannerContainer';
import { useAppStore } from '@/stores';

const navigation = vi.hoisted(() => ({ push: vi.fn(), pathname: '/' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/sandbox/useSandboxEventsSocket', () => ({
  useSandboxEventsSocket: () => ({ connState: 'open', attempt: 0 }),
}));
const workbench = () =>
  mount(
    <AppFrameContainer>
      <WorkbenchContainer />
    </AppFrameContainer>,
  );
beforeEach(() => {
  navigation.pathname = '/';
});
describe('WB · shared navigation, object routing and overview', () => {
  it('AC-WB-003/004: first-use welcome creates nothing and unavailable task entry explains its prerequisite', async () => {
    const creates = vi.fn();
    server.use(
      http.post(`${API}/api/projects`, () => {
        creates();
        return HttpResponse.json(project());
      }),
    );
    workbench();
    await screen.findByRole('button', { name: '用我的代码库' });
    expect(screen.getByRole('button', { name: '开一个空项目' })).toBeInTheDocument();
    const task = screen.getByTestId('new-task-entry');
    task.focus();
    expect(task).toHaveFocus();
    expect(task).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(task);
    expect(screen.queryByTestId('modal-new-task')).not.toBeInTheDocument();
    expect(creates).not.toHaveBeenCalled();
  });
  it('AC-WB-006/007: overview and sidebar use one waiting-input filter and keep recent tasks separate from attention', async () => {
    server.use(
      http.get(`${API}/api/projects`, () =>
        HttpResponse.json([
          project({ taskCount: 3 }),
          project({ id: 'project-empty', name: '空项目' }),
        ]),
      ),
      http.get(`${API}/api/sandboxes`, () =>
        HttpResponse.json([
          sandbox({ id: 'waiting', name: '等我确认', waitingInput: true }),
          sandbox({ id: 'recent', name: '最近运行', updatedAt: NOW }),
          sandbox({ id: 'stopped', name: '已经停止', status: 'stopped', waitingInput: true }),
        ]),
      ),
    );
    workbench();
    await screen.findAllByText('等我确认');
    act(() => {
      useAppStore.getState().setTaskStatusFilter('waitingInput');
    });
    await screen.findAllByRole('button', { name: '移除筛选：等待输入' });
    const tree = screen.getByRole('navigation', { name: '项目分组任务树' });
    expect(within(tree).getByText('等我确认')).toBeInTheDocument();
    expect(within(tree).queryByText('已经停止')).not.toBeInTheDocument();
    expect(within(tree).queryByText('最近运行')).not.toBeInTheDocument();
    expect(screen.getByText('按筛选显示 1 个 / 共 2 个')).toBeInTheDocument();
    expect(screen.getByText('等待输入的任务都列在「需要你处理」里')).toBeInTheDocument();
  });
  it('AC-WB-008: missing selected object clears both selections and replaces the URL with a neutral overview notice', async () => {
    useAppStore.setState({ selectedProjectId: 'project-a', selectedSandboxId: 'gone' });
    window.history.replaceState({ workbenchTaskName: '旧构建任务' }, '', '/?taskId=gone');
    server.use(
      http.get(`${API}/api/sandboxes/gone`, () =>
        HttpResponse.json(
          { code: 'NOT_FOUND', message: 'gone', retryable: false },
          { status: 404 },
        ),
      ),
      http.get(`${API}/api/projects`, () => HttpResponse.json([project()])),
    );
    workbench();
    await screen.findByText('找不到任务「旧构建任务」：可能已被销毁。');
    expect(useAppStore.getState().selectedProjectId).toBeNull();
    expect(useAppStore.getState().selectedSandboxId).toBeNull();
    expect(window.location.search).toBe('');
    expect(screen.queryByTestId('sandbox-outcome')).not.toBeInTheDocument();
  });
  it('AC-WB-014: command group and synonym search executes an enabled action and hands focus to its dialog', () => {
    const close = vi.fn();
    const defer = vi.fn();
    mount(
      <CommandPaletteContainer
        projects={[project()]}
        tasks={[]}
        pathname="/"
        onClose={close}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        deferFocusRestore={defer}
      />,
    );
    const query = screen.getByRole('combobox', { name: '查找任务、项目与动作' });
    fireEvent.change(query, { target: { value: '新建' } });
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('新建项目'),
        expect.stringContaining('新任务'),
      ]),
    );
    fireEvent.keyDown(query, { key: 'Enter' });
    expect(useAppStore.getState().currentModal).toBe('createProject');
    expect(close).toHaveBeenCalledOnce();
    expect(defer).toHaveBeenCalledOnce();
  });
  it('AC-WB-014: no-match combobox removes active descendant and controls references rather than pointing at missing results', () => {
    mount(
      <CommandPaletteContainer
        projects={[]}
        tasks={[]}
        pathname="/"
        onClose={vi.fn()}
        onCloseAutoFocus={vi.fn()}
        deferFocusRestore={vi.fn()}
      />,
    );
    const query = screen.getByRole('combobox', { name: '查找任务、项目与动作' });
    fireEvent.change(query, { target: { value: 'nothing-matches-this' } });
    expect(query).not.toHaveAttribute('aria-activedescendant');
    expect(query).not.toHaveAttribute('aria-controls');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });
  it('AC-WB-011: governance from all projects appears on overview and names the actual rule before any panel has opened', async () => {
    server.use(
      http.get(`${API}/api/automations/attention`, () =>
        HttpResponse.json([
          {
            projectId: 'project-a',
            projectName: 'acme-web',
            id: 'nightly',
            name: '每日说明',
            status: 'autoDisabled',
            consecutiveFailures: 10,
          },
        ]),
      ),
    );
    mount(<GlobalBannerContainer />);
    await screen.findByText('有 1 条定时规则已自动停用');
    expect(screen.getByText(/acme-web 的「每日说明」/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看这些规则' }));
    expect(useAppStore.getState().selectedProjectForMenu).toBe('project-a');
    expect(useAppStore.getState().currentModal).toBe('automations');
  });
  it('AC-WB-007: resource card reports registered/max/remaining from the provider ledger rather than active-task guess', async () => {
    server.use(http.get(`${API}/api/projects`, () => HttpResponse.json([project()])));
    workbench();
    await screen.findByText('已登记 8 / 8 个任务 · 还能再发 0 个');
  });
  it('AC-CRD-033.6: credentials page suppresses only account-expiry governance and preserves disk pressure', async () => {
    navigation.pathname = '/settings/credentials';
    server.use(
      http.get(`${API}/api/runtimes`, () =>
        HttpResponse.json([runtime({ credentialStatus: 'expired' })]),
      ),
      http.get(`${API}/api/system/resources`, () =>
        HttpResponse.json({
          ...resources,
          disk: { ...resources.disk, level: 'warn', usedPercent: 85 },
        }),
      ),
    );
    const mounted = mount(<GlobalBannerContainer />);
    await screen.findByText('磁盘快满了');
    expect(screen.queryByText('Codex 的帐号登录已过期')).not.toBeInTheDocument();
    navigation.pathname = '/';
    mounted.rerender(<GlobalBannerContainer />);
    await screen.findByText('Codex 的帐号登录已过期');
    expect(screen.getByText('磁盘快满了')).toBeInTheDocument();
  });
  it('AC-WB-010/AC-DEP-001: failed boot snapshot releases the shell once, shows unknown-state banner and never restarts on consumer mount', async () => {
    const reads = vi.fn();
    server.use(
      http.get(`${API}/api/system/init-status`, () => {
        reads();
        return HttpResponse.json(
          { code: 'NETWORK_ERROR', message: 'backend unavailable', retryable: true },
          { status: 500 },
        );
      }),
    );
    mount(
      <AppBootGate>
        <GlobalBannerContainer />
        <p>已挂载的工作区</p>
      </AppBootGate>,
    );
    await screen.findByText('无法确认平台状态');
    expect(screen.getByText('已挂载的工作区')).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(reads).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('app-boot-skeleton')).not.toBeInTheDocument();
  });
  it('AC-PRJ-041.1/042.1: project menu handoff keeps cancellation focused after the closing menu releases its focus scope', async () => {
    server.use(
      http.get(`${API}/api/projects`, () => HttpResponse.json([project()])),
      http.get(`${API}/api/projects/project-a/deletion-preview`, () =>
        HttpResponse.json({
          activeTasks: [],
          retainedVolumeCount: 0,
          automationCount: 0,
          automationRunCount: 0,
          taskCount: 0,
        }),
      ),
    );
    workbench();
    const trigger = await screen.findByTitle('acme-web 的项目菜单');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const deleteItem = await screen.findByTestId('group-menu-delete');
    deleteItem.focus();
    fireEvent.pointerDown(deleteItem, { button: 0 });
    fireEvent.mouseDown(deleteItem, { button: 0 });
    fireEvent.mouseUp(deleteItem, { button: 0 });
    fireEvent.click(deleteItem);
    await screen.findByRole('dialog', { name: '删除项目「acme-web」？' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    await waitFor(() => {
      expect(screen.getByTestId('delete-cancel')).toHaveFocus();
    });
    fireEvent.click(screen.getByTestId('delete-cancel'));
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });
  it('AC-AUT-001.3/001.5: a task-context Find lists each ready project once, opens another project without switching the task, and restores its opener', async () => {
    useAppStore.setState({ selectedProjectId: 'project-a', selectedSandboxId: 'task-a' });
    server.use(
      http.get(`${API}/api/projects`, () =>
        HttpResponse.json([
          project({ taskCount: 1 }),
          project({ id: 'project-b', name: '示例项目' }),
          project({ id: 'project-failed', name: '克隆失败', cloneStatus: 'failed' }),
          project({ id: 'project-cloning', name: '正在克隆', cloneStatus: 'cloning' }),
        ]),
      ),
      http.get(`${API}/api/sandboxes`, () => HttpResponse.json([sandbox({ status: 'stopped' })])),
      http.get(`${API}/api/sandboxes/task-a`, () =>
        HttpResponse.json(sandbox({ status: 'stopped' })),
      ),
    );
    workbench();
    const opener = await screen.findByTestId('new-task-entry');
    opener.focus();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const query = await screen.findByRole('combobox', { name: '查找任务、项目与动作' });
    fireEvent.change(query, { target: { value: '自动化' } });
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('自动化规则 · acme-web');
    expect(options[1]).toHaveTextContent('自动化规则 · 示例项目');
    await waitFor(() => {
      expect(options[1]).toHaveTextContent('还没有规则');
    });
    fireEvent.click(options[1] ?? query);
    const dialog = await screen.findByRole('dialog', { name: '自动化规则' });
    expect(within(dialog).getByText('在 示例项目 中')).toBeInTheDocument();
    expect(useAppStore.getState().selectedProjectId).toBe('project-a');
    expect(useAppStore.getState().selectedSandboxId).toBe('task-a');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    });
  });
});
