import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AuthMethodRadioRowView } from '@/views/settings/AuthMethodRadioRow.view';
import type { AuthModeRow } from '@/types/runtimeCredential';

const noop = (): void => undefined;

const activeAccount: AuthModeRow = {
  mode: 'account',
  method: 'oauth-device',
  label: '帐号授权',
  configured: true,
  active: true,
  maskedIdentifier: 'a***@gmail.com',
  expiryLabel: '剩 30 天',
  expiryState: 'ok',
};

const meta: Meta<typeof AuthMethodRadioRowView> = {
  title: 'Settings/AuthMethodRadioRow',
  component: AuthMethodRadioRowView,
  parameters: { layout: 'centered' },
  args: {
    row: activeAccount,
    onSwitch: noop,
    onNeedSetup: noop,
    onReauth: noop,
    onAddKey: noop,
    onRevoke: noop,
  },
};
export default meta;

type Story = StoryObj<typeof AuthMethodRadioRowView>;

/** 生效中 + [生效中] 徽标。 */
export const ActiveAccount: Story = {};

/** 已配置未生效（○，点击 → onSwitch）。 */
export const ConfiguredInactive: Story = {
  args: { row: { ...activeAccount, active: false } },
};

/** 未选中未配置（显「未配置」，点击 → onNeedSetup）。 */
export const NotConfigured: Story = {
  args: {
    row: {
      mode: 'api-key',
      method: 'api-key',
      label: 'API Key',
      configured: false,
      active: false,
      expiryState: 'noExpiry',
    },
  },
};

/** <7 天预警。 */
export const Expiring: Story = {
  args: { row: { ...activeAccount, expiryLabel: '剩 6 天', expiryState: 'warning' } },
};

/** 已过期。 */
export const Expired: Story = {
  args: { row: { ...activeAccount, expiryLabel: '已过期', expiryState: 'expired' } },
};
