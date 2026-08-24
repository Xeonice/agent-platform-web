import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { TestConnectionResultView } from '@/views/settings/TestConnectionResult.view';

const meta: Meta<typeof TestConnectionResultView> = {
  title: 'Settings/TestConnectionResult',
  component: TestConnectionResultView,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof TestConnectionResultView>;

export const Testing: Story = { args: { testing: true } };
export const Ok: Story = { args: { result: { ok: true, message: '' } } };
export const Failed: Story = {
  args: {
    result: { ok: false, message: '认证失败：凭证无效或没有该仓库的访问权限，请检查凭证。' },
  },
};
