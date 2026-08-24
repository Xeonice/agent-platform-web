import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CloneProgressView } from '@/views/project/CloneProgress.view';

const noop = (): void => undefined;

const meta: Meta<typeof CloneProgressView> = {
  title: 'Project/CloneProgress',
  component: CloneProgressView,
  parameters: { layout: 'fullscreen' },
  args: {
    projectName: 'acme/web',
    onRetry: noop,
    onConvertToEmpty: noop,
    onDone: noop,
    onConfigureCredentials: noop,
  },
};
export default meta;

type Story = StoryObj<typeof CloneProgressView>;

export const Cloning: Story = {
  args: {
    phase: 'cloning',
    percent: 45,
    detailLabel: '接收对象 · 11,203/26,348 · 4.2 MB · 189.0 KB/s',
    elapsedLabel: '已用 0:38',
  },
};
export const Indeterminate: Story = { args: { phase: 'cloning', percent: null } };
export const Slow: Story = {
  args: {
    phase: 'slow',
    percent: 62,
    detailLabel: '接收对象 · 16,340/26,348 · 7.8 MB · 12.0 KB/s',
    elapsedLabel: '已用 4:12',
  },
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
    guidanceMessage: '没有访问该仓库的权限。请配置 Git 访问凭证后重试克隆。',
    canRetry: false,
    needsCredentials: true,
  },
};

/**
 * receiving 开始前的空窗（实测 3.4s 起，慢远端更久）。
 * 改造前这一段**一个数都没有**：只有一条脉冲条，用户完全不知道它在干嘛。
 */
export const EnumeratingBlindWindow: Story = {
  args: {
    phase: 'cloning',
    percent: null,
    detailLabel: '枚举远端对象 · 共 26,348 个对象',
    elapsedLabel: '已用 0:03',
  },
};

/** 卡住的样子：速率归零比百分比停住更早暴露问题。 */
export const ReceivingStalled: Story = {
  args: {
    phase: 'slow',
    percent: 62,
    detailLabel: '接收对象 · 16,340/26,348 · 7.8 MB · 0 B/s',
    elapsedLabel: '已用 6:40',
  },
};
