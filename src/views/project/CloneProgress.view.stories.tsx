import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CloneProgressView } from '@/views/project/CloneProgress.view';

const noop = (): void => undefined;

const meta: Meta<typeof CloneProgressView> = {
  title: 'Project/CloneProgress',
  component: CloneProgressView,
  parameters: { layout: 'fullscreen' },
  args: { projectName: 'acme/web', onRetry: noop, onConvertToEmpty: noop, onDone: noop },
};
export default meta;

type Story = StoryObj<typeof CloneProgressView>;

export const Cloning: Story = {
  args: { phase: 'cloning', percent: 45, detailLabel: '18.0 MB / 40.0 MB' },
};
export const Indeterminate: Story = { args: { phase: 'cloning', percent: null } };
export const Slow: Story = {
  args: { phase: 'slow', percent: 62, detailLabel: '25.0 MB / 40.0 MB' },
};
export const Done: Story = { args: { phase: 'done', percent: 100 } };
export const FailedNetwork: Story = {
  args: {
    phase: 'failed',
    percent: null,
    guidanceMessage: '网络错误导致克隆失败，请检查网络后重试。',
    canRetry: true,
  },
};
export const FailedPermission: Story = {
  args: {
    phase: 'failed',
    percent: null,
    guidanceMessage: '没有访问该仓库的权限。需要配置访问凭证后重试（凭证管理将在后续版本提供）。',
    canRetry: false,
    needsCredentials: true,
  },
};
