import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Ellipsis } from 'lucide-react';
import { AppSidebarView } from '@/views/workbench/AppSidebar.view';
import type { ProjectGroup, Sandbox } from '@/types/domain';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const groups: ProjectGroup[] = [
  {
    projectId: 'acme-web',
    projectName: 'acme-web',
    cloneStatus: 'ready',
    collapsed: false,
    taskCount: 3,
    tasks: [
      {
        id: 'build',
        projectId: 'acme-web',
        name: '迁移构建脚本',
        status: 'running',
        waitingInput: false,
        lastActiveAt: 0,
        activityLabel: '活跃于 2 分钟前',
      },
      {
        id: 'login',
        projectId: 'acme-web',
        name: '检查登录流程',
        status: 'running',
        waitingInput: true,
        lastActiveAt: 0,
      },
      {
        id: 'test',
        projectId: 'acme-web',
        name: '运行回归测试',
        status: 'error',
        waitingInput: false,
        lastActiveAt: 0,
      },
    ],
  },
  {
    projectId: 'docs',
    projectName: 'docs-site',
    cloneStatus: 'ready',
    collapsed: false,
    taskCount: 0,
    tasks: [],
  },
  {
    projectId: 'clone',
    projectName: 'api-service',
    cloneStatus: 'cloning',
    collapsed: true,
    taskCount: 0,
    tasks: [],
  },
];

const designTasks: Sandbox[] = [
  {
    id: 'e2e',
    projectId: 'acme-web',
    name: '补 e2e 用例',
    status: 'running',
    rawStatus: 'running',
    waitingInput: true,
    lastActiveAt: 0,
    activityLabel: '活跃于 刚刚',
    phaseLabel: '运行中',
  },
  {
    id: 'refresh',
    projectId: 'acme-web',
    name: '修一下登录态刷新',
    status: 'running',
    rawStatus: 'running',
    waitingInput: false,
    lastActiveAt: 0,
    activityLabel: '活跃于 1 分钟前',
    phaseLabel: '运行中',
  },
  {
    id: 'release',
    projectId: 'acme-web',
    name: '整理发布说明',
    status: 'running',
    rawStatus: 'idle',
    waitingInput: false,
    lastActiveAt: 0,
    activityLabel: '活跃于 1 小时前',
    phaseLabel: '空闲',
  },
  {
    id: 'payment',
    projectId: 'acme-web',
    name: '重构支付回调',
    status: 'running',
    rawStatus: 'running',
    waitingInput: true,
    lastActiveAt: 0,
    activityLabel: '活跃于 4 分钟前',
    phaseLabel: '运行中',
  },
  {
    id: 'image-failed',
    projectId: 'acme-web',
    name: '迁移构建脚本',
    status: 'error',
    rawStatus: 'failed',
    waitingInput: false,
    lastActiveAt: 0,
    phaseLabel: '启动失败：没能把镜像拉下来',
    failureOperation: 'provision',
  },
  {
    id: 'timeout',
    projectId: 'acme-web',
    name: '升级依赖到 Node 22',
    status: 'error',
    rawStatus: 'failed',
    waitingInput: false,
    lastActiveAt: 0,
    phaseLabel: '超时未响应：这一步等太久，平台先停下了',
    failureCode: 'TIMEOUT',
    failureOperation: 'provision',
  },
  {
    id: 'nightly',
    projectId: 'acme-web',
    name: '每天凌晨跑一遍回归 #12',
    status: 'running',
    rawStatus: 'running',
    waitingInput: false,
    lastActiveAt: 0,
    activityLabel: '活跃于 刚刚',
    phaseLabel: '运行中',
  },
];
const designGroups: ProjectGroup[] = [
  {
    projectId: 'acme-web',
    projectName: 'acme-web',
    cloneStatus: 'ready',
    collapsed: false,
    taskCount: 7,
    tasks: designTasks,
  },
  {
    projectId: 'sample',
    projectName: '示例项目',
    cloneStatus: 'ready',
    collapsed: true,
    taskCount: 3,
    tasks: [],
  },
  {
    projectId: 'acme-api',
    projectName: 'acme-api',
    cloneStatus: 'failed',
    collapsed: true,
    taskCount: 0,
    tasks: [],
  },
  {
    projectId: 'docs',
    projectName: 'docs-site',
    cloneStatus: 'ready',
    collapsed: true,
    taskCount: 0,
    tasks: [],
  },
  {
    projectId: 'infra',
    projectName: 'infra-scripts',
    cloneStatus: 'cloning',
    collapsed: true,
    taskCount: 0,
    tasks: [],
  },
];

function FixtureTaskMenu({ task }: { task: Sandbox }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={`${task.name} 的任务菜单`}
        >
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={fn()}>查看任务</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
function FixtureGroupMenu({ projectId }: { projectId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={`${projectId} 的项目菜单`}
        >
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={fn()}>项目信息</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const meta = {
  title: 'Workbench/AppSidebar',
  component: AppSidebarView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story, context) => (
      <div
        className={`flex ${context.parameters['sidebarFullHeight'] ? 'h-screen' : 'h-[680px]'} bg-background text-foreground`}
      >
        <Story />
      </div>
    ),
  ],
  args: {
    groups,
    waitingInputCount: 1,
    selectedTaskId: 'build',
    selectedProjectId: 'acme-web',
    activePath: '/',
    onFind: fn(),
    onShortcuts: fn(),
    onToggleSidebar: fn(),
    onSelectTask: fn(),
    onSelectProject: fn(),
    onNewProject: fn(),
    onNewTask: fn(),
    onToggleGroupCollapse: fn(),
    onStatusFilterChange: fn(),
    onThemeChange: fn(),
  },
} satisfies Meta<typeof AppSidebarView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectsAndTasks: Story = {};
export const SettingsActive: Story = { args: { activePath: '/settings/images' } };
export const Collapsed: Story = { args: { sidebarCollapsed: true } };
export const Loading: Story = { args: { groups: [], waitingInputCount: 0, isLoading: true } };
export const NoProjects: Story = {
  args: { groups: [], waitingInputCount: 0, newTaskDisabledReason: '先新建一个项目' },
};
export const NoFilterMatches: Story = {
  args: { groups: [], statusFilter: 'error', hasNoFilterMatches: true },
};
export const EventsReconnecting: Story = {
  args: { eventsMessage: '正在重连事件流，任务状态暂时不会更新…' },
};

export const DesignSevenTasks: Story = {
  parameters: { sidebarFullHeight: true },
  args: {
    groups: designGroups,
    waitingInputCount: 2,
    selectedTaskId: 'nightly',
    selectedProjectId: 'acme-web',
    renderTaskMenu: (task) => <FixtureTaskMenu task={task} />,
    renderGroupMenu: (projectId) => <FixtureGroupMenu projectId={projectId} />,
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const sidebar = canvas.getByRole('complementary', { name: '侧栏' });
    const rows = sidebar.querySelectorAll<HTMLElement>('[data-task-id]');
    await expect(rows.length).toBe(7);
    for (const row of rows) {
      await expect(row.getBoundingClientRect().height).toBe(48);
      const dot = row.querySelector('[data-slot="status-dot"]');
      await expect(dot?.getBoundingClientRect().width).toBe(8);
      await expect(dot?.getBoundingClientRect().left).toBe(
        sidebar.getBoundingClientRect().left + 40,
      );
    }
    await expect(canvas.getByText('修一下登录态刷新').getBoundingClientRect().left).toBe(
      sidebar.getBoundingClientRect().left + 60,
    );
    await expect(canvas.getByTestId('task-activity-release')).toHaveTextContent(
      '活跃于 1 小时前 · 空闲',
    );
    await expect(canvas.getByTestId('task-activity-e2e')).toHaveTextContent(
      '活跃于 刚刚 · 等待你输入',
    );
    await expect(canvas.getByTestId('task-activity-refresh')).toHaveTextContent('活跃于 1 分钟前');
    await expect(canvas.queryByText('运行中')).not.toBeInTheDocument();
    await expect(canvas.queryByTestId('task-activity-image-failed')).not.toBeInTheDocument();
    await expect(canvas.getByText('启动失败：没能把镜像拉下来')).toBeInTheDocument();
    await expect(getComputedStyle(canvas.getByText('启动失败：没能把镜像拉下来')).color).not.toBe(
      getComputedStyle(canvas.getByText('超时未响应：这一步等太久，平台先停下了')).color,
    );
    await expect(canvas.getByRole('button', { name: 'acme-web，7 个任务' })).not.toHaveAttribute(
      'aria-current',
    );
    const selected = canvas.getByText('每天凌晨跑一遍回归 #12').closest('button');
    if (!selected) throw new Error('选中任务缺少选择按钮');
    await expect(selected).toHaveAttribute('aria-current', 'true');
    await expect(getComputedStyle(selected).fontWeight).toBe('500');

    const taskMenu = canvas.getByRole('button', { name: '补 e2e 用例 的任务菜单' });
    await userEvent.hover(taskMenu);
    await userEvent.click(taskMenu);
    await waitFor(() =>
      expect(within(document.body).getByRole('menuitem', { name: '查看任务' })).toBeVisible(),
    );
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(within(document.body).getByRole('menuitem', { name: '查看任务' })).toHaveFocus(),
    );
    const taskMenuWrapper = taskMenu.parentElement;
    if (!taskMenuWrapper) throw new Error('任务菜单缺少行内定位容器');
    await waitFor(() => expect(getComputedStyle(taskMenuWrapper).opacity).toBe('1'));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(taskMenu).toHaveFocus());

    const projectMenu = canvas.getByRole('button', { name: 'acme-web 的项目菜单' });
    await userEvent.click(projectMenu);
    await waitFor(() =>
      expect(within(document.body).getByRole('menuitem', { name: '项目信息' })).toBeVisible(),
    );
    const projectCount = canvas.getAllByTestId('project-group-count')[0];
    if (!projectCount) throw new Error('项目缺少任务计数');
    await waitFor(() => expect(getComputedStyle(projectCount).opacity).toBe('0'));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(projectMenu).toHaveFocus());
    const task = canvas.getByText('补 e2e 用例').closest('button');
    if (!task) throw new Error('任务缺少选择按钮');
    task.focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onSelectTask).toHaveBeenCalledWith('e2e');
  },
};
export const SoulKillerTask: Story = {
  parameters: { sidebarFullHeight: true },
  args: {
    groups: [
      {
        projectId: 'soul-killer',
        projectName: 'soul-killer',
        cloneStatus: 'ready',
        collapsed: false,
        taskCount: 1,
        tasks: [
          {
            id: 'soul-task',
            projectId: 'soul-killer',
            name: '分析当前项目并输出报告',
            status: 'running',
            rawStatus: 'running',
            waitingInput: false,
            lastActiveAt: 0,
            activityLabel: '活跃于 1 小时前',
            phaseLabel: '运行中',
          },
        ],
      },
      {
        projectId: 'sss',
        projectName: 'sss',
        cloneStatus: 'ready',
        collapsed: false,
        taskCount: 0,
        tasks: [],
      },
    ],
    waitingInputCount: 0,
    selectedTaskId: 'soul-task',
    selectedProjectId: 'soul-killer',
    renderTaskMenu: (task) => <FixtureTaskMenu task={task} />,
    renderGroupMenu: (projectId) => <FixtureGroupMenu projectId={projectId} />,
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const project = canvas.getByRole('button', { name: 'soul-killer，1 个任务' });
    await expect(project).not.toHaveAttribute('aria-current');
    await expect(canvas.getByTestId('task-activity-soul-task')).toHaveTextContent(
      '活跃于 1 小时前',
    );
    await expect(canvas.queryByText('运行中')).not.toBeInTheDocument();
    const empty = canvas.getByTestId('empty-group-new-task-sss');
    await expect(empty.getBoundingClientRect().height).toBe(32);
    await userEvent.click(empty);
    await expect(args.onSelectProject).toHaveBeenCalledWith('sss');
    await expect(args.onNewTask).toHaveBeenCalledOnce();
  },
};
