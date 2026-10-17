import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { upgradeViewFixture } from './versionUpdateFixture';
import { VersionUpdateProgressView } from '@/views/system/VersionUpdateProgress.view';
const meta: Meta<typeof VersionUpdateProgressView> = {
  title: 'System/VersionUpdateProgress',
  component: VersionUpdateProgressView,
  args: {
    model: upgradeViewFixture({
      phase: 'ongoing',
      percent: 45,
      showDot: false,
      canUpgrade: false,
      progressText: '迁移与检查 · 45%',
    }),
  },
};
export default meta;
type Story = StoryObj<typeof VersionUpdateProgressView>;
export const Ongoing: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '45',
    );
  },
};
export const Unknown: Story = {
  args: {
    model: upgradeViewFixture({ phase: 'ongoing', percent: null, progressText: '等待进度确认' }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('progressbar')).not.toHaveAttribute(
      'aria-valuenow',
    );
  },
};
export const AvailableHasNoPercent: Story = {
  args: { model: upgradeViewFixture() },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('progressbar')).not.toBeInTheDocument();
  },
};
export const KnownDownloadUnknownOverall: Story = {
  args: {
    model: upgradeViewFixture({
      phase: 'ongoing',
      canUpgrade: false,
      percent: null,
      progressText: '本次总体进度待确认',
      stageProgress: {
        label: '安装包下载阶段',
        percent: 64,
        workText: '60.4 MB / 94.3 MB',
        elapsedText: '当前阶段已用 2:18',
        lastProgressText: '最后实质进展 刚刚',
        stale: false,
      },
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('progressbar', { name: '本实例升级进度' })).not.toHaveAttribute(
      'aria-valuenow',
    );
    await expect(canvas.getByRole('progressbar', { name: '安装包下载阶段进度' })).toHaveAttribute(
      'aria-valuenow',
      '64',
    );
  },
};
