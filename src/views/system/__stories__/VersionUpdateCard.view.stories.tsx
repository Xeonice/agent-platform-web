import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { upgradeViewFixture } from './versionUpdateFixture';
import { VersionUpdateCardView } from '@/views/system/VersionUpdateCard.view';
const meta: Meta<typeof VersionUpdateCardView> = {
  title: 'System/VersionUpdateCard',
  component: VersionUpdateCardView,
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
    headingRef: null,
    authorizationOpen: false,
    onAuthorizationOpenChange: fn(),
    authorizationBusy: false,
    authorizationError: null,
    onAuthorize: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof VersionUpdateCardView>;
export const Available: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { name: '版本与更新' })).toBeVisible();
  },
};
export const ReadOnlyAuthorization: Story = {
  args: { model: upgradeViewFixture({ canUpgrade: false, canAuthenticate: true }) },
};
export const Unknown: Story = {
  args: {
    model: upgradeViewFixture({
      phase: 'unknown',
      title: '版本与更新',
      subtitle: '暂时无法确认版本与升级状态',
      showEntry: false,
      canUpgrade: false,
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: '检查更新' })).toBeVisible();
  },
};
