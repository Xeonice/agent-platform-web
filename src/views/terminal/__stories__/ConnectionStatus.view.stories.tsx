import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within, fn } from 'storybook/test';
import { ConnectionStatusView } from '@/views/terminal/ConnectionStatus.view';
const meta: Meta<typeof ConnectionStatusView> = {
  title: 'Terminal/ConnectionStatus',
  component: ConnectionStatusView,
  args: { onManualReconnect: fn() },
};
export default meta;
type Story = StoryObj<typeof ConnectionStatusView>;
export const Connecting: Story = {
  args: { connState: 'connecting', attachmentState: 'restoring' },
};
export const TransportOpenAwaitingOriginalIdentity: Story = {
  args: { connState: 'open', attachmentState: 'restoring' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent(
      '等待运行环境与终端身份确认',
    );
  },
};
export const OriginalAttachmentConfirmed: Story = {
  args: { connState: 'open', attachmentState: 'attached' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('status')).not.toBeInTheDocument();
  },
};
export const Reconnecting: Story = {
  args: { connState: 'reconnecting', attempt: 3, attachmentState: 'restoring' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('第 3 次');
    await expect(canvasElement.textContent).not.toContain('任务在后台继续跑');
  },
};
export const Closed: Story = {
  args: { connState: 'closed', attachmentState: 'unconfirmed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '手动重连' })).toBeInTheDocument();
    await expect(canvasElement.textContent).toContain('运行状态待确认');
    await expect(canvasElement.textContent).not.toContain('还在后台跑');
  },
};
export const SlowRestoration: Story = {
  args: { connState: 'open', attachmentState: 'unconfirmed', restoringSlow: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('超过 15 秒');
    await expect(
      within(canvasElement).getByRole('link', { name: '查看系统状态' }),
    ).toBeInTheDocument();
  },
};
export const SchemaMismatch: Story = {
  args: {
    connState: 'closed',
    attachmentState: 'incompatible',
    canRetry: false,
    handshakeErrorMessage: '终端协议无法兼容，请查看系统版本详情；不会因此停止原任务。',
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('button', { name: '手动重连' }),
    ).not.toBeInTheDocument();
  },
};
export const ReconnectingAfterUnauthorized: Story = {
  args: {
    connState: 'reconnecting',
    attempt: 1,
    attachmentState: 'auth-expired',
    handshakeErrorMessage: '访问授权已过期，请解锁后续接原终端。',
    canRetry: true,
  },
};
export const TerminalGone: Story = {
  args: {
    connState: 'closed',
    attachmentState: 'gone',
    canRetry: false,
    handshakeErrorMessage: '已确认原终端不存在。保留原任务信息，不会自动创建替代终端。',
  },
};
