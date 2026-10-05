import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { SandboxRestoreStateView } from '@/views/sandbox/SandboxRestoreState.view';

const meta = {
  title: 'sandbox/SandboxRestoreState',
  component: SandboxRestoreStateView,
  args: { pending: true, onRetry: fn() },
} satisfies Meta<typeof SandboxRestoreStateView>;
export default meta;
export const Pending: StoryObj<typeof meta> = {};
export const Error: StoryObj<typeof meta> = {
  args: { pending: false, errorMessage: '暂时无法读取任务详情，请检查网络后重试。' },
};
