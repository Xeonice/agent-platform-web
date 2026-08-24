import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { RuntimeCredentialCardView } from '@/views/settings/RuntimeCredentialCard.view';
import type { AuthModeRow, RuntimeCredentialCardModel } from '@/types/runtimeCredential';

const noop = (): void => undefined;

const accountRow: AuthModeRow = {
  mode: 'account',
  method: 'oauth-device',
  label: '帐号授权',
  configured: true,
  active: true,
  maskedIdentifier: 'a***@gmail.com',
  credentialId: 'rc-1',
  expiryLabel: '剩 30 天',
  expiryState: 'ok',
};

const apiKeyRowEmpty: AuthModeRow = {
  mode: 'api-key',
  method: 'api-key',
  label: 'API Key',
  configured: false,
  active: false,
  expiryState: 'noExpiry',
};

const accountActive: RuntimeCredentialCardModel = {
  runtimeId: 'codex',
  displayName: 'Codex',
  vendor: 'OpenAI',
  status: 'active',
  hasAnyCredential: true,
  rows: [accountRow, apiKeyRowEmpty],
};

const meta: Meta<typeof RuntimeCredentialCardView> = {
  title: 'Settings/RuntimeCredentialCard',
  component: RuntimeCredentialCardView,
  parameters: { layout: 'padded' },
  args: {
    model: accountActive,
    onSwitch: noop,
    onNeedSetup: noop,
    onReauth: noop,
    onAddKey: noop,
    onRevoke: noop,
  },
};
export default meta;

type Story = StoryObj<typeof RuntimeCredentialCardView>;

/** ◉ 帐号授权生效中。 */
export const AccountActive: Story = {};

/** ◉ API Key 生效中（帐号授权行留存未生效）。 */
export const ApiKeyActive: Story = {
  args: {
    model: {
      ...accountActive,
      rows: [
        { ...accountRow, active: false, configured: false, maskedIdentifier: undefined },
        {
          mode: 'api-key',
          method: 'api-key',
          label: 'API Key',
          configured: true,
          active: true,
          maskedIdentifier: 'sk-...ab12',
          credentialId: 'rc-2',
          expiryState: 'noExpiry',
        },
      ],
    },
  },
};

/** ○ 全未配置（无凭证简化态）。 */
export const Unconfigured: Story = {
  args: {
    model: {
      runtimeId: 'claude-code',
      displayName: 'Claude Code',
      vendor: 'Anthropic',
      status: 'none',
      hasAnyCredential: false,
      rows: [
        {
          mode: 'account',
          method: 'setup-token',
          label: '帐号授权',
          configured: false,
          active: false,
          expiryState: 'noExpiry',
        },
        apiKeyRowEmpty,
      ],
    },
  },
};

/** ⚠️ <7 天预警。 */
export const Expiring: Story = {
  args: {
    model: {
      ...accountActive,
      status: 'expiring',
      rows: [{ ...accountRow, expiryLabel: '剩 6 天', expiryState: 'warning' }, apiKeyRowEmpty],
    },
  },
};

/** ❌ 已过期。 */
export const Expired: Story = {
  args: {
    model: {
      ...accountActive,
      status: 'expired',
      rows: [{ ...accountRow, expiryLabel: '已过期', expiryState: 'expired' }, apiKeyRowEmpty],
    },
  },
};
