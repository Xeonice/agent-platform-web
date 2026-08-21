import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SetupTokenAuthView } from '@/views/wizard/auth/SetupTokenAuth.view';

const noop = (): void => undefined;

const meta: Meta<typeof SetupTokenAuthView> = {
  title: 'Wizard/SetupTokenAuth',
  component: SetupTokenAuthView,
  parameters: { layout: 'centered' },
  args: {
    verificationUrl: 'https://claude.ai/setup-token',
    instructions: '在浏览器完成授权后，复制授权码粘贴回来。',
    code: '',
    onCodeChange: noop,
    onSubmit: noop,
  },
};
export default meta;

type Story = StoryObj<typeof SetupTokenAuthView>;

export const AwaitingPaste: Story = {};

export const Submitting: Story = { args: { code: 'auth-code-xyz', submitting: true } };

export const CodeError: Story = {
  args: { code: 'bad-code', error: '授权码无效或已过期，请重新获取后粘贴。' },
};
