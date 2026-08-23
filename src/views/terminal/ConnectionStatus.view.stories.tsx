import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ConnectionStatusView } from '@/views/terminal/ConnectionStatus.view';

const meta: Meta<typeof ConnectionStatusView> = {
  title: 'Terminal/ConnectionStatus',
  component: ConnectionStatusView,
};
export default meta;

type Story = StoryObj<typeof ConnectionStatusView>;

const noop = (): void => undefined;

export const Connecting: Story = { args: { connState: 'connecting', onManualReconnect: noop } };
export const Reconnecting: Story = {
  args: { connState: 'reconnecting', attempt: 3, onManualReconnect: noop },
};
/** 退避耗尽的正常终点：给出显式的「手动重连」入口，把决定权交回用户（08 §11.6）。 */
export const Closed: Story = { args: { connState: 'closed', onManualReconnect: noop } };
