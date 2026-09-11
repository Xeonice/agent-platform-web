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

/** 码真的到点了：归零转红 + [换一串重来]。 */
export const Expired: Story = {
  args: { secondsLeft: 0, polling: false, expired: true, expiredReason: 'expired' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/这串设备码已经到期了/)).toBeVisible();
  },
};

/**
 * ⛔ **前端 10 分钟兜底触发**：这是我们不等了，**码可能完全没过期**。
 * 此前两者共用一句「设备码已过期。」—— 一句在这条路径上是错的话。
 */
export const GaveUpWaiting: Story = {
  args: { secondsLeft: 0, polling: false, expired: true, expiredReason: 'gave-up' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/可能还有效/)).toBeVisible();
    await expect(canvas.queryByText(/已经到期了/)).toBeNull();
  },
};

/**
 * ⛔ **后端没给 expiresAt**：不渲染倒计时。
 * 此前这里是一个红色的 `00:00`，底下同时写着「等待授权中…」—— 编出来的数字，还自相矛盾。
 */
export const NoExpiry: Story = {
  args: { secondsLeft: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByLabelText('倒计时')).toBeNull();
  },
};

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
