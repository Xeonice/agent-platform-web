import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { upgradeViewFixture } from './versionUpdateFixture';
import { VersionUpdateNoticeView } from '@/views/system/VersionUpdateNotice.view';
const meta: Meta<typeof VersionUpdateNoticeView> = {
  title: 'System/VersionUpdateNotice',
  component: VersionUpdateNoticeView,
  args: {
    model: upgradeViewFixture(),
    busy: false,
    onUpgrade: fn(),
    onRefresh: fn(),
    onDetails: fn(),
    onClose: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof VersionUpdateNoticeView>;
export const Available: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: '今天不再提醒' })).toBeVisible();
  },
};
export const ReadOnly: Story = { args: { model: upgradeViewFixture({ canUpgrade: false }) } };
export const Ongoing: Story = {
  args: {
    model: upgradeViewFixture({
      phase: 'ongoing',
      canUpgrade: false,
      showDot: false,
      percent: 75,
      progressText: '观测连续性 · 75%',
    }),
  },
};
