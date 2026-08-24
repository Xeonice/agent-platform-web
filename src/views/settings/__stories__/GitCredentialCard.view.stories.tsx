import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { GitCredentialCardView } from '@/views/settings/GitCredentialCard.view';

const noop = (): void => undefined;

const meta: Meta<typeof GitCredentialCardView> = {
  title: 'Settings/GitCredentialCard',
  component: GitCredentialCardView,
  parameters: { layout: 'centered' },
  args: {
    onReplace: noop,
    onTest: noop,
    onRevoke: noop,
    onConfigureSsh: noop,
    onConfigureHttps: noop,
  },
};
export default meta;

type Story = StoryObj<typeof GitCredentialCardView>;

export const Unconfigured: Story = { args: { credential: null } };

export const SshConfigured: Story = {
  args: {
    lastUsedLabel: '2 小时前',
    credential: {
      id: 'gc-ssh',
      kind: 'git',
      type: 'ssh-key',
      maskedIdentifier: 'SHA256:abc123def456',
      allowedHosts: [],
      knownHosts: [
        {
          host: 'git.internal.example.com',
          keyType: 'ssh-ed25519',
          fingerprint: 'SHA256:xyz789',
          firstSeenAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
    },
  },
};

export const HttpsConfigured: Story = {
  args: {
    lastUsedLabel: '刚刚',
    credential: {
      id: 'gc-https',
      kind: 'git',
      type: 'https-token',
      maskedIdentifier: 'ghp_…ab12',
      platform: 'github',
      allowedHosts: ['github.com', 'git.internal.example.com'],
      createdAt: new Date().toISOString(),
    },
  },
};

export const Testing: Story = {
  args: {
    testing: true,
    credential: {
      id: 'gc-https',
      kind: 'git',
      type: 'https-token',
      maskedIdentifier: 'ghp_…ab12',
      platform: 'github',
      allowedHosts: ['github.com'],
      createdAt: new Date().toISOString(),
    },
  },
};

export const TestFailed: Story = {
  args: {
    testResult: { ok: false, message: '认证失败：凭证无效或没有该仓库的访问权限，请检查凭证。' },
    credential: {
      id: 'gc-https',
      kind: 'git',
      type: 'https-token',
      maskedIdentifier: 'ghp_…ab12',
      platform: 'github',
      allowedHosts: ['github.com'],
      createdAt: new Date().toISOString(),
    },
  },
};
