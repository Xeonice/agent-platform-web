import type { Meta, StoryObj } from '@storybook/nextjs-vite';
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
    onSubmit: noop,
  },
};
export default meta;

type Story = StoryObj<typeof ApiKeyAuthView>;

export const Empty: Story = {};

/** 前缀非法红边。 */
export const InvalidPrefix: Story = { args: { value: 'oops-123', prefixValid: false } };

export const Submitting: Story = { args: { value: 'sk-abcdef', submitting: true } };

/** AUTH_REJECTED 就地红字 + 可能原因列表（不弹层）。 */
export const Rejected: Story = {
  args: {
    value: 'sk-abcdef',
    error: '凭证被拒绝，请检查后重试。',
    reasons: ['凭证格式错误', '无权限或额度不足'],
  },
};
