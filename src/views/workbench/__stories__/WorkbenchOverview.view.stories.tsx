import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { WorkbenchOverviewView } from '@/views/workbench/WorkbenchOverview.view';
import type { Project, Sandbox } from '@/types/domain';

const projects: Project[] = [
  { id: 'acme-web', name: 'acme-web', cloneStatus: 'ready', taskCount: 3 },
  { id: 'docs', name: 'docs-site', cloneStatus: 'ready', taskCount: 0 },
  { id: 'clone', name: 'api-service', cloneStatus: 'cloning', taskCount: 0 },
  { id: 'failed', name: '旧项目代码库', cloneStatus: 'failed', taskCount: 0 },
];
const tasks: Sandbox[] = [
  {
    id: 'build',
    projectId: 'acme-web',
    name: '迁移构建脚本',
    status: 'running',
    waitingInput: false,
    lastActiveAt: 0,
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
];

const meta = {
  title: 'Workbench/WorkbenchOverview',
  component: WorkbenchOverviewView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex min-h-[640px] bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
  args: {
    projects,
    tasks,
    isLoading: false,
    isError: false,
    onRetry: fn(),
    onSelectProject: fn(),
    onSelectTask: fn(),
    onNewProject: fn(),
  },
} satisfies Meta<typeof WorkbenchOverviewView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectsAndAttention: Story = {};
export const NoAttention: Story = { args: { tasks: [] } };
export const Welcome: Story = { args: { projects: [], tasks: [] } };
export const Loading: Story = { args: { projects: [], tasks: [], isLoading: true } };
export const ReadFailure: Story = { args: { projects: [], tasks: [], isError: true } };
