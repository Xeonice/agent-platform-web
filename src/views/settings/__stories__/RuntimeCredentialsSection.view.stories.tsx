import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { RuntimeCredentialsSectionView } from '@/views/settings/RuntimeCredentialsSection.view';
import type { RuntimeCredentialCardModel } from '@/types/runtimeCredential';

const noop = (): void => undefined;
const panelNone = (): undefined => undefined;

const codex: RuntimeCredentialCardModel = {
  runtimeId: 'codex',
  displayName: 'Codex',
  vendor: 'OpenAI',
  status: 'active',
  hasAnyCredential: true,
  rows: [
    {
      mode: 'account',
      method: 'oauth-device',
      label: '帐号授权',
      configured: true,
      active: true,
      maskedIdentifier: 'a***@gmail.com',
      credentialId: 'rc-1',
      expiryLabel: '剩 30 天',
      expiryState: 'ok',
    },
    {
      mode: 'api-key',
      method: 'api-key',
      label: 'API Key',
      configured: false,
      active: false,
      expiryState: 'noExpiry',
    },
  ],
};

const meta: Meta<typeof RuntimeCredentialsSectionView> = {
  title: 'Settings/RuntimeCredentialsSection',
  component: RuntimeCredentialsSectionView,
  parameters: { layout: 'padded' },
  args: {
    cards: [codex],
    search: '',
    onSearch: noop,
    panelFor: panelNone,
    onSwitch: noop,
    onNeedSetup: noop,
    onReauth: noop,
    onAddKey: noop,
    onRevoke: noop,
  },
};
export default meta;

type Story = StoryObj<typeof RuntimeCredentialsSectionView>;

export const Default: Story = {};

export const Loading: Story = { args: { loading: true } };

export const NoMatch: Story = { args: { cards: [], search: 'zzz' } };
