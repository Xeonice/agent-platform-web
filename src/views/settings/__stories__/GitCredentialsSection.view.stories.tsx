import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { GitCredentialsSectionView } from '@/views/settings/GitCredentialsSection.view';

const noop = (): void => undefined;

const meta: Meta<typeof GitCredentialsSectionView> = {
  title: 'Settings/GitCredentialsSection',
  component: GitCredentialsSectionView,
  parameters: { layout: 'fullscreen' },
  args: {
    guidanceText: 'GitHub / GitLab SaaS → HTTPS Token；公司自建 Git（SSH 接入）→ SSH 密钥。',
    missingTypes: ['ssh-key', 'https-token'],
    onConfigureSsh: noop,
    onConfigureHttps: noop,
    onReplace: noop,
    onTest: noop,
    onRevoke: noop,
  },
};
export default meta;

type Story = StoryObj<typeof GitCredentialsSectionView>;

export const Unconfigured: Story = { args: { cards: [] } };

export const Loading: Story = { args: { loading: true, cards: [] } };

export const HttpsConfigured: Story = {
  args: {
    missingTypes: ['ssh-key'],
    cards: [
      {
        credential: {
          id: 'gc-https',
          kind: 'git',
          type: 'https-token',
          maskedIdentifier: 'ghp_…ab12',
          platform: 'github',
          allowedHosts: ['github.com'],
          createdAt: new Date().toISOString(),
        },
        lastUsedLabel: '2 小时前',
      },
    ],
  },
};

export const CloneReturnBanner: Story = {
  args: {
    cards: [],
    pendingRetry: { name: 'acme/web', retrying: false, onRetry: noop, onDiscard: noop },
  },
};
