import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { DeviceCodeAuthView } from '@/views/wizard/auth/DeviceCodeAuth.view';

const noop = (): void => undefined;

const meta: Meta<typeof DeviceCodeAuthView> = {
  title: 'Wizard/DeviceCodeAuth',
  component: DeviceCodeAuthView,
  parameters: { layout: 'centered' },
  args: {
    userCode: 'WDJB-MJHT',
    verificationUrl: 'https://openai.com/device',
    secondsLeft: 14 * 60,
    polling: true,
    pollError: false,
    expired: false,
    onCopy: noop,
    onRefetchChallenge: noop,
  },
};
export default meta;

type Story = StoryObj<typeof DeviceCodeAuthView>;

export const Polling: Story = {};

/** 剩 5min 转黄。 */
export const WarnCountdown: Story = { args: { secondsLeft: 4 * 60 } };

/** 归零转红 + [重新获取]。 */
export const Expired: Story = { args: { secondsLeft: 0, polling: false, expired: true } };

/** 连续网络错误：网络异常 [重试]（倒计时不受影响）。 */
export const PollNetworkError: Story = { args: { pollError: true } };
