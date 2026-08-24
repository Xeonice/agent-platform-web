import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HttpsTokenFormView } from '@/views/settings/HttpsTokenForm.view';

const noop = (): void => undefined;

const meta: Meta<typeof HttpsTokenFormView> = {
  title: 'Settings/HttpsTokenForm',
  component: HttpsTokenFormView,
  parameters: { layout: 'centered' },
  args: {
    platformOptions: [
      { value: 'github', label: 'GitHub' },
      { value: 'gitlab', label: 'GitLab' },
      { value: 'gitee', label: 'Gitee' },
      { value: 'other', label: '其他（自建）' },
    ],
    platform: 'github',
    onPlatformChange: noop,
    token: '',
    onTokenChange: noop,
    allowedHosts: ['github.com'],
    onAllowedHostsChange: noop,
    scopeHint: '需 repo（仓库读取）权限的 Token。',
    onTest: noop,
    onSubmit: noop,
    onCancel: noop,
  },
};
export default meta;

type Story = StoryObj<typeof HttpsTokenFormView>;

export const GithubDefault: Story = { args: { submitDisabled: true } };
export const OtherSelfHosted: Story = {
  args: { platform: 'other', allowedHosts: ['git.internal.example.com'], token: 'ghp_x' },
};
export const Submitting: Story = { args: { token: 'ghp_x', submitting: true } };
