import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { UnlockFormView } from '@/views/access/UnlockForm.view';

const noop = (): void => undefined;

const meta: Meta<typeof UnlockFormView> = {
  title: 'Access/UnlockForm',
  component: UnlockFormView,
  parameters: { layout: 'centered' },
  args: { onSubmit: noop },
};
export default meta;

type Story = StoryObj<typeof UnlockFormView>;

export const Default: Story = { args: { submitting: false } };
export const WithReason: Story = {
  args: { submitting: false, reason: '会话已过期，请重新输入访问口令。' },
};
export const Submitting: Story = { args: { submitting: true } };
export const InvalidPasscode: Story = {
  args: { submitting: false, errorMessage: '口令错误，请重试。' },
};
