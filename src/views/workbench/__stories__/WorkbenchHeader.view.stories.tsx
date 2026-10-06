import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { WorkbenchHeaderView } from '@/views/workbench/WorkbenchHeader.view';

const meta = {
  title: 'Workbench/WorkbenchHeader',
  component: WorkbenchHeaderView,
  parameters: { layout: 'fullscreen' },
  args: {
    projects: [
      { id: 'acme-web', name: 'acme-web', cloneStatus: 'ready', taskCount: 3 },
      { id: 'docs', name: 'docs-site', cloneStatus: 'ready', taskCount: 0 },
    ],
    currentProjectName: 'acme-web',
    onSelectProject: fn(),
    onOverview: fn(),
    onNewTask: fn(),
  },
} satisfies Meta<typeof WorkbenchHeaderView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SelectedProject: Story = {};
export const Overview: Story = { args: { currentProjectName: null } };
export const NoProject: Story = {
  args: { projects: [], currentProjectName: null, newTaskDisabledReason: '先新建一个项目' },
};
export const Loading: Story = { args: { projects: [], currentProjectName: null, isLoading: true } };
export const EnvironmentUnavailable: Story = {
  args: {
    healthLabel: '沙箱环境不可用',
    newTaskDisabledReason: '沙箱环境没有响应，请先查看系统状态',
  },
};
export const LongProjectName: Story = {
  args: { currentProjectName: '平台运行环境与自动化任务管理服务的开发项目' },
};
