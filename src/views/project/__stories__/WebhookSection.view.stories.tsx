// F21-7 §7.2 / §9.1 #12：webhook 启用（URL + triggerOn 三选 + [测试连接]）与投递纪律。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { WebhookSectionView } from '@/views/project/WebhookSection.view';

// ⚠️ 手抄一份，与 `lib/automation/validateWebhookUrl` 的常量**互为独立期望**
//    （story 是 view 元素，禁止 import lib；而且从实现派生期望等于用实现证明实现）。
const DELIVERY_NOTE =
  '投递超时 10 秒；失败重试 2 次（间隔 5 秒、25 秒）。两次重试仍失败只记一条投递失败，不影响规则的启用状态。';

const meta: Meta<typeof WebhookSectionView> = {
  title: 'Project/WebhookSection',
  component: WebhookSectionView,
  parameters: { layout: 'padded' },
  args: {
    enabled: true,
    url: 'https://example.com/hooks/automation',
    triggerOn: 'failure',
    deliveryNote: DELIVERY_NOTE,
    testPhase: 'idle',
    onEnabledChange: fn(),
    onUrlChange: fn(),
    onTriggerOnChange: fn(),
    onTest: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof WebhookSectionView>;

/** 启用：URL + 三个 triggerOn + [测试连接] + 投递纪律。 */
export const Enabled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('webhook-url')).toHaveValue(
      'https://example.com/hooks/automation',
    );
    await expect(canvas.getByTestId('webhook-trigger-failure')).toBeChecked();
    await expect(canvas.getByTestId('webhook-trigger-success')).toBeInTheDocument();
    await expect(canvas.getByTestId('webhook-trigger-all')).toBeInTheDocument();

    // ⭐ 退避序列是 5s / 25s（03 §8.5 / P21-7 §7），⛔ 不是 1s→2s→4s。
    const note = canvas.getByTestId('webhook-delivery-note');
    await expect(note).toHaveTextContent('10 秒');
    await expect(note).toHaveTextContent('5 秒');
    await expect(note).toHaveTextContent('25 秒');
    // ⭐ 投递失败不影响规则状态（#30 否定性验收）。
    await expect(note).toHaveTextContent('不影响规则');
  },
};

/** 未启用：URL 与 triggerOn 都不渲染（一个开着但空的 URL 框是在邀请用户存一条坏规则）。 */
export const Disabled: Story = {
  args: { enabled: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId('webhook-url')).toBeNull();
    await expect(canvas.queryByTestId('webhook-test')).toBeNull();
  },
};

export const Testing: Story = {
  args: { testPhase: 'testing' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('webhook-test')).toBeDisabled();
  },
};

export const TestOk: Story = {
  args: { testPhase: 'ok' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('webhook-test-ok')).toBeInTheDocument();
  },
};

export const TestFailed: Story = {
  args: { testPhase: 'error', testErrorMessage: '目标地址不可达' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('webhook-test-error')).toHaveTextContent(
      '目标地址不可达',
    );
  },
};

export const UrlInvalid: Story = {
  args: { url: 'ftp://x/y', errorMessage: '只支持 http / https。' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('webhook-error')).toBeInTheDocument();
  },
};
