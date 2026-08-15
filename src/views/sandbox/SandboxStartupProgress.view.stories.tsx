import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SandboxStartupProgressView } from '@/views/sandbox/SandboxStartupProgress.view';

const PHASES = [
  { key: 'init', label: '初始化' },
  { key: 'workspace', label: '准备工作区' },
  { key: 'image', label: '拉取镜像' },
  { key: 'instance', label: '启动实例' },
] as const;

const meta: Meta<typeof SandboxStartupProgressView> = {
  title: 'Sandbox/StartupProgress',
  component: SandboxStartupProgressView,
  parameters: { layout: 'fullscreen' },
  args: { phases: PHASES },
};
export default meta;

type Story = StoryObj<typeof SandboxStartupProgressView>;

export const Init: Story = { args: { activeIndex: 0, percent: 20, statusLabel: 'pending' } };
export const Workspace: Story = {
  args: { activeIndex: 1, percent: 40, statusLabel: 'preparing-workspace' },
};
export const PullingImage: Story = {
  args: { activeIndex: 2, percent: 60, statusLabel: 'creating' },
};
export const Starting: Story = { args: { activeIndex: 3, percent: 80, statusLabel: 'starting' } };
