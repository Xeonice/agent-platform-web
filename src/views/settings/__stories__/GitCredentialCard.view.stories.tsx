import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
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

export const Unconfigured: Story = {
  args: { credential: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⭐ 「未配置」= skipped（虚线框），⛔ 不是 fail：断言到 data-status 这一级，
    // 换成 fail 这条会先红——只断言"有个 pill"锁不住这条。
    await expect(canvas.getByTestId('git-unconfigured-badge')).toHaveAttribute(
      'data-status',
      'skipped',
    );
  },
};

/**
 * ⛔ **接口挂了 ≠ 没配过。**
 * 此前加载失败也落到 `credential === null` 这一支，屏幕上是「○ 未配置」+ [配置 SSH 密钥] ——
 * 用户会以为自己的密钥被清了。这一条钉住失败态自成一格、且**不给「去配一个新的」的引导**。
 */
export const LoadFailed: Story = {
  args: { credential: null, loadFailed: true, onRetryLoad: noop },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('git-load-error')).toBeVisible();
    await expect(canvas.getByRole('button', { name: '重试' })).toBeVisible();
    await expect(canvas.queryByTestId('git-unconfigured-badge')).toBeNull();
    await expect(canvas.queryByRole('button', { name: '配置 SSH 密钥' })).toBeNull();
  },
};

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
