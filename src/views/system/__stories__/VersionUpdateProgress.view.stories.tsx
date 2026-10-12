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
