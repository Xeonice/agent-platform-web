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

/**
 * **协议漂移**（握手 `SCHEMA_MISMATCH`）：确定性失败，重连按不通。
 * 状态条被这条人话接管——不显示"正在重连"，也**不给**那个按不通的「手动重连」。
 * 对照上面的 Closed：那才是"重连有意义"的断线。
 */
export const SchemaMismatch: Story = {
  args: {
    connState: 'closed',
    onManualReconnect: noop,
    handshakeErrorMessage:
      '页面版本与后端不一致（前端不是最新的），请刷新页面；重连不会解决这个问题。',
  },
};

/** 未授权是**另一类**：可自愈（解锁后下次重连即通过）⇒ 仍走普通的重连黄条，不占用上面那条路径。 */
export const ReconnectingAfterUnauthorized: Story = {
  args: { connState: 'reconnecting', attempt: 1, onManualReconnect: noop },
};
