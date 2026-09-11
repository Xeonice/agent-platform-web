import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ApiKeyAuthView } from '@/views/wizard/auth/ApiKeyAuth.view';

const noop = (): void => undefined;

const meta: Meta<typeof ApiKeyAuthView> = {
  title: 'Wizard/ApiKeyAuth',
  component: ApiKeyAuthView,
  parameters: { layout: 'centered' },
  args: {
    value: '',
    onValueChange: noop,
    expectedPrefix: 'sk-',
    prefixValid: true,
    vendor: 'OpenAI',
    onSubmit: noop,
  },
};
export default meta;

type Story = StoryObj<typeof ApiKeyAuthView>;

export const Empty: Story = {};

/**
 * 前缀不匹配：红边 + 红字，**但 [保存并继续] 依然可点**。
 *
 * ⛔ 此前 `disabled` 含 `!prefixValid` —— 前端猜错前缀的代价是「合法凭证根本提交不了」。
 * 判定权在后端，前端只提示。
 */
export const InvalidPrefix: Story = {
  args: { value: 'oops-123', prefixValid: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toBeVisible();
    await expect(canvas.getByRole('button', { name: '保存并继续' })).toBeEnabled();
  },
};

/** 没有 vendor（第三方 runtime 没声明）⇒ 不猜名字，只说「去签发它的厂商控制台」。 */
export const NoVendor: Story = {
  args: { vendor: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/签发它的厂商控制台/)).toBeVisible();
  },
};

export const Submitting: Story = { args: { value: 'sk-abcdef', submitting: true } };

/** AUTH_REJECTED 就地红字 + 可能原因列表（不弹层）。 */
export const Rejected: Story = {
  args: {
    value: 'sk-abcdef',
    error: '这份凭证没被接受。',
    reasons: ['开头不是 sk-ant-', '长度不够，可能被截断了'],
  },
};
