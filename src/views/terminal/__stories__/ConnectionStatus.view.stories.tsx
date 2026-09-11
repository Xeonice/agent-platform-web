import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ConnectionStatusView } from '@/views/terminal/ConnectionStatus.view';

const meta: Meta<typeof ConnectionStatusView> = {
  title: 'Terminal/ConnectionStatus',
  component: ConnectionStatusView,
};
export default meta;

type Story = StoryObj<typeof ConnectionStatusView>;

const noop = (): void => undefined;

export const Connecting: Story = { args: { connState: 'connecting', onManualReconnect: noop } };
/**
 * ⭐ 重连中：**必须说清任务本身没停**（2026-09-11 补）。
 *
 * 用户此刻最想知道的不是"这是第几次重试"，而是"我的 agent 还在跑吗"。
 * 断线重连**确实恢复现场**（终端网关 attach 的是后端一直活着的那个会话），
 * 所以这一句可以这么说 —— ⚠️ 它与「回收后重启」是两件事，那一件⛔ 不许这么说。
 *
 * MUTATION: 把那半句删掉 ⇒ 第二条断言红。
 */
export const Reconnecting: Story = {
  args: { connState: 'reconnecting', attempt: 3, onManualReconnect: noop },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('第 3 次');
    await expect(canvasElement.textContent).toContain('任务在后台继续跑');
  },
};
/**
 * ⭐ 退避耗尽的正常终点：给出显式的「手动重连」入口，把决定权交回用户（08 §11.6）。
 *
 * ⚠️ 本轮补了两件事（旧文案只有「连接超时，已停止自动重连。」）：
 *   · **超时 ≠ 不可达** —— 真相是"重试次数用完了"，不是"证明连不上"。把前者说成后者，
 *     用户会以为环境挂了；
 *   · **任务本身怎么样了** —— 断的只是这条看屏幕的连接，agent 会话一直活着。
 *     不说这一句，用户此刻最想知道的那件事没人回答。
 *
 * MUTATION: 把文案改回「连接超时，已停止自动重连。」⇒ 后两条断言红。
 */
export const Closed: Story = {
  args: { connState: 'closed', onManualReconnect: noop },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '手动重连' })).toBeInTheDocument();
    // 不把"这几次没连上"说成"连不上"。
    await expect(canvasElement.textContent).toContain('不代表连不上');
    // 任务本身的下落必须交代。
    await expect(canvasElement.textContent).toContain('还在后台跑');
  },
};

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
