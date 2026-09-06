import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
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
    onOpenAuthPage: fn(),
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

// ——— v1.2：开新标签页（F07 §6.2a）———

export const CodeCopied: Story = {
  args: { codeCopied: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('open-auth-page')).toBeVisible();
    await expect(canvas.getByText(/已复制到剪贴板/)).toBeVisible();
  },
};

export const PopupBlocked: Story = {
  args: { popupBlocked: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⛔ 被拦了必须显形，且给一条真能点的路 —— 静默失败会让用户盯着「等待授权中」到码过期。
    const alert = canvas.getByTestId('popup-blocked');
    await expect(alert).toBeVisible();
    const link = within(alert).getByRole('link');
    await expect(link).toHaveAttribute('target', '_blank');
    // ⚠️ `noopener` 不能省：不带它新标签页能把原页面导走（reverse tabnabbing）。
    await expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  },
};

export const ClickOpensAuthPage: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId('open-auth-page'));
    await expect(args.onOpenAuthPage).toHaveBeenCalled();
  },
};
