import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ConnectionStatusView } from '@/views/terminal/ConnectionStatus.view';

const meta: Meta<typeof ConnectionStatusView> = {
  title: 'Terminal/ConnectionStatus',
  component: ConnectionStatusView,
};
export default meta;

type Story = StoryObj<typeof ConnectionStatusView>;

export const Connecting: Story = { args: { connState: 'connecting' } };
export const Reconnecting: Story = { args: { connState: 'reconnecting', attempt: 3 } };
export const Closed: Story = { args: { connState: 'closed' } };
