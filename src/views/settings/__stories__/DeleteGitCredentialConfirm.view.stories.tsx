import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, waitFor, within } from 'storybook/test';
import { DeleteGitCredentialConfirmView } from '@/views/settings/DeleteGitCredentialConfirm.view';
import type { GitCredentialDeletionModel } from '@/types/gitCredential';

const token: GitCredentialDeletionModel = {
  title: '删除 GitHub Token？',
  subtitle: 'ghp_…ab12',
  subject: '这份 HTTPS Token（ghp_…ab12）',
  hosts: 'github.com',
  provider: 'GitHub',
  ssh: false,
  projectNames: ['acme-web', 'docs-site'],
  projectsKnown: true,
};

const meta: Meta<typeof DeleteGitCredentialConfirmView> = {
  title: 'Settings/DeleteGitCredentialConfirm',
  component: DeleteGitCredentialConfirmView,
  args: {
    model: token,
    busy: false,
    onConfirm: fn(),
    onCancel: fn(),
    onRetryProjects: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof DeleteGitCredentialConfirmView>;

export const HttpsToken: Story = {
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body);
    await expect(dialog.getByRole('heading', { name: token.title })).toBeVisible();
    await expect(dialog.getByText(/acme-web、docs-site/)).toBeVisible();
    await expect(dialog.getByText(/平台不再保存它/)).toBeVisible();
    await expect(dialog.getByText(/Token 本身/)).toBeVisible();
    await waitFor(() => expect(dialog.getByRole('button', { name: '取消' })).toHaveFocus());
  },
};

export const SshKey: Story = {
  args: {
    model: {
      ...token,
      title: '删除 SSH 私钥？',
      subtitle: 'SHA256:public-fingerprint',
      subject: '这份 SSH 私钥（SHA256:public-fingerprint）',
      ssh: true,
    },
  },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body);
    await expect(dialog.getByText(/SSH Keys 设置/)).toBeVisible();
    await expect(dialog.getByText(/SSH 地址/)).toBeVisible();
  },
};

export const ProjectsUnknown: Story = {
  args: { model: { ...token, projectsKnown: false, projectNames: [] } },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body);
    await expect(dialog.getByRole('alert')).toHaveTextContent('这不代表没有相关项目');
    await expect(dialog.getByRole('button', { name: '重试读取' })).toBeEnabled();
    await expect(dialog.queryByText(/没有相关项目$/)).toBeNull();
  },
};

export const NoRelatedProjects: Story = {
  args: { model: { ...token, projectNames: [] } },
};

export const Deleting: Story = {
  args: { busy: true },
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body);
    await expect(dialog.getByRole('button', { name: '删除中…' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '取消' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '关闭' })).toBeDisabled();
  },
};
