import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { upgradeViewFixture } from './versionUpdateFixture';
import { VersionUpdateDetailsView } from '@/views/system/VersionUpdateDetails.view';
const meta: Meta<typeof VersionUpdateDetailsView> = {
  title: 'System/VersionUpdateDetails',
  component: VersionUpdateDetailsView,
  args: {
    model: upgradeViewFixture(),
    busy: false,
    isChecking: false,
    commandMessage: null,
    onCheck: fn(),
    onUpgrade: fn(),
    onRefresh: fn(),
    onLater: fn(),
    onDetails: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof VersionUpdateDetailsView>;
export const Available: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: '立即升级' })).toBeVisible();
  },
};
export const ReadOnly: Story = {
  args: { model: upgradeViewFixture({ canUpgrade: false }) },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('button', { name: '立即升级' }),
    ).not.toBeInTheDocument();
  },
};
export const Ready: Story = {
  args: {
    model: upgradeViewFixture({
      phase: 'ready',
      title: '实例已安装新版',
      subtitle: '方便时刷新页面，接回原任务和原终端',
      canUpgrade: false,
      canRefresh: true,
      percent: 100,
    }),
  },
};
