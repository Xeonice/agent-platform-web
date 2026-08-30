import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { OfflineNoticeView } from '@/views/init/OfflineNotice.view';

const meta: Meta<typeof OfflineNoticeView> = {
  title: 'Init/OfflineNotice',
  component: OfflineNoticeView,
  parameters: { layout: 'padded' },
  args: { acknowledged: false, onContinue: fn() },
};
export default meta;

type Story = StoryObj<typeof OfflineNoticeView>;

/**
 * ⭐ **[继续] 必须可点**（F21-8 §7.2）：离线不阻断初始化 —— air-gapped 是产品支持的一档部署
 * （P21-8 §1），把它做成"离线就不让装"等于把一个受支持的形态堵死。
 */
export const Offline: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: '我知道，继续' });
    await expect(button).toBeEnabled();
    // 说清是**物理约束**而不是"请检查网络设置"——后者会让用户在一台确实没外网的机器上一直找自己的错。
    await expect(canvas.getByTestId('offline-notice')).toHaveTextContent('物理约束');
    await expect(canvas.getByTestId('offline-notice')).toHaveTextContent('其余功能');
    await userEvent.click(button);
    await expect(args.onContinue).toHaveBeenCalled();
  },
};

/** 确认之后**不消失**：用户要能看见自己确认了什么。 */
export const Acknowledged: Story = {
  args: { acknowledged: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('offline-acknowledged')).toHaveTextContent(
      '已确认以离线模式继续',
    );
    await expect(canvas.queryByRole('button', { name: '我知道，继续' })).toBeNull();
  },
};
