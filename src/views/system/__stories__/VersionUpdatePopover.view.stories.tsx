import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { upgradeViewFixture } from './versionUpdateFixture';
import { VersionUpdatePopoverView } from '@/views/system/VersionUpdatePopover.view';
const meta: Meta<typeof VersionUpdatePopoverView> = {
  title: 'System/VersionUpdatePopover',
  component: VersionUpdatePopoverView,
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
    open: false,
    onOpenChange: fn(),
    triggerRef: null,
    contentRef: null,
    onCloseAutoFocus: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof VersionUpdatePopoverView>;
export const Available: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: '版本与更新' })).toBeVisible();
    await expect(within(canvasElement).getByTestId('upgrade-available-dot')).toBeInTheDocument();
  },
};
export const Ongoing: Story = {
  args: {
    model: upgradeViewFixture({ phase: 'ongoing', showDot: false, canUpgrade: false, percent: 20 }),
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByTestId('upgrade-available-dot'),
    ).not.toBeInTheDocument();
  },
};
export const NoUpdate: Story = {
  args: {
    model: upgradeViewFixture({
      phase: 'none',
      showEntry: false,
      showDot: false,
      canUpgrade: false,
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).not.toBeInTheDocument();
  },
};
