import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { TestConnectionResultView } from '@/views/settings/TestConnectionResult.view';

const meta: Meta<typeof TestConnectionResultView> = {
  title: 'Settings/TestConnectionResult',
  component: TestConnectionResultView,
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj<typeof TestConnectionResultView>;

export const Testing: Story = { args: { testing: true } };

export const Ok: Story = {
  args: { result: { ok: true, message: '' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('连接成功')).toBeInTheDocument();
    // MUTATION：把 `<Check>` 换回 ✅ 字符或换成 `<X>` ⇒ 这条先红——只锁文案
    // 锁不住"真的换成了成功图标"。
    await expect(
      canvas.getByTestId('test-connection-icon').classList.contains('lucide-check'),
    ).toBe(true);
  },
};

export const Failed: Story = {
  args: {
    result: { ok: false, message: '认证失败：凭证无效或没有该仓库的访问权限，请检查凭证。' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/认证失败/)).toBeInTheDocument();
    await expect(canvas.getByTestId('test-connection-icon').classList.contains('lucide-x')).toBe(
      true,
    );
  },
};
