import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { CredentialsSecurityFooterView } from '@/views/settings/CredentialsSecurityFooter.view';

const meta: Meta<typeof CredentialsSecurityFooterView> = {
  title: 'Settings/CredentialsSecurityFooter',
  component: CredentialsSecurityFooterView,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof CredentialsSecurityFooterView>;

/**
 * 产品 §3 的三句承诺缺一不可。
 * ⛔ 第二句（「帐号登录在你自己的浏览器里完成，平台不接触你的密码」）曾被**整条删掉**，
 *    而前端设计文档验收表 #23 恰好写着这条「删掉不会有人发现」—— 它确实被删了，也确实没人发现。
 *    这个 play 就是那句话的看门人。
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/加密保存在这台机器上/)).toBeVisible();
    await expect(canvas.getByText(/平台不接触你的密码/)).toBeVisible();
    await expect(canvas.getByText(/只留指纹 \/ 尾号/)).toBeVisible();
  },
};
