import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { AppSidebarView } from '@/views/workbench/AppSidebar.view';
import type { ProjectGroup } from '@/types/domain';

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

const meta = {
  title: 'Workbench/AppSidebar',
  component: AppSidebarView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex h-[680px] bg-background text-foreground">
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
