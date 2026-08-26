import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { UpdateCompareDialogView } from '@/views/image/UpdateCompareDialog.view';

const noop = (): void => undefined;

const meta: Meta<typeof UpdateCompareDialogView> = {
  title: 'Image/UpdateCompareDialog',
  component: UpdateCompareDialogView,
  parameters: { layout: 'fullscreen' },
  args: {
    imageName: 'ml-agent',
    refDisplay: 'docker.io/myrepo/ml-agent:v1.0',
    currentDigestShort: 'sha256:4b17e…a02',
    currentResolvedAtLabel: '解析于 3 天前',
    upstreamDigestShort: 'sha256:8e05a…77f',
    upstreamValidation: { status: 'valid', pinnedDigestShort: 'sha256:8e05a…77f' },
    onAdopt: noop,
    onDismiss: noop,
    onViewRequirements: noop,
  },
};
export default meta;

type Story = StoryObj<typeof UpdateCompareDialogView>;

/** 新版本 ✅ —— play：新旧 digest 同屏可比，且 [更新到新版本] 可点。 */
export const UpstreamValid: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('current-digest')).toHaveTextContent('sha256:4b17e…a02');
    await expect(canvas.getByTestId('upstream-digest')).toHaveTextContent('sha256:8e05a…77f');
    await expect(canvas.getByRole('button', { name: '更新到新版本' })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: '暂不更新' })).toBeInTheDocument();
  },
};

/** 新版本 ⚠️：仍可更新，但把后果说明一起摆出来。 */
export const UpstreamWarning: Story = {
  args: {
    upstreamValidation: {
      status: 'warning',
      pinnedDigestShort: 'sha256:8e05a…77f',
      warnings: ['未预装 claude-code，创建时需现装，实测约 12.5 分钟'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '更新到新版本' })).toBeEnabled();
  },
};

/**
 * 新版本 ❌ —— play（**否定断言**）：[更新到新版本] **不渲染**（不是渲染出来再置灰），
 * 并明说「已保留当前版本」。一次检查不该把一张正在好好用着的镜像变成不能用的（P21-4 §5 ★）。
 */
export const UpstreamInvalid: Story = {
  args: {
    upstreamValidation: {
      status: 'invalid',
      errors: ['上游新版本缺少 tmux'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: '更新到新版本' })).toBeNull();
    await expect(canvas.getByTestId('kept-current-version')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: '暂不更新' })).toBeInTheDocument();
  },
};

/** 更新中：两颗按钮都锁住，避免重复提交。 */
export const Updating: Story = {
  args: { updating: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '更新中…' })).toBeDisabled();
  },
};
