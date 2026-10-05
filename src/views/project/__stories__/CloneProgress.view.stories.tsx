import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AppDialogView } from '@/views/common/AppDialog.view';
import { CloneProgressView } from '@/views/project/CloneProgress.view';

const noop = (): void => undefined;

const meta: Meta<typeof CloneProgressView> = {
  title: 'Project/CloneProgress',
  component: CloneProgressView,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <AppDialogView title="新建项目" layout="form" onClose={noop} testId="storybook-project-clone">
        <Story />
      </AppDialogView>
    ),
  ],
  args: {
    projectName: 'infra-scripts',
    onCancel: noop,
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
    percent: 42,
    detailLabel: '接收对象（第 4/6 步） · 11,066/26,348 · 18.4 MB · 1.2 MB/s',
    elapsedLabel: '已用 0:38',
  },
};
export const Indeterminate: Story = { args: { phase: 'cloning', percent: null } };
export const Slow: Story = {
  args: {
    phase: 'slow',
    percent: null,
    detailLabel: '枚举远端对象（第 1/6 步） · 共 26,348 个对象',
    elapsedLabel: '已用 10:06',
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
    guidanceMessage:
      '远端拒绝了这次访问：凭证无效或没有这个仓库的权限。配置 Git 访问凭证后可重试克隆。',
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
    detailLabel: '枚举远端对象（第 1/6 步） · 共 26,348 个对象',
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

export const FailedNotFound: Story = {
  args: {
    phase: 'failed',
    percent: null,
    guidanceMessage:
      '打不开这个仓库：可能是私有仓库还没配 Git 凭证，也可能是地址写错了。如果是私有仓库，配好凭证后可以重试克隆；如果是地址写错了，远端地址建好之后改不了，需要删掉这个项目重新建一个。',
    canRetry: false,
    needsCredentials: true,
  },
};
