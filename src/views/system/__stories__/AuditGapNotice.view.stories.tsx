import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AuditGapNoticeView } from '@/views/system/AuditGapNotice.view';

const meta: Meta<typeof AuditGapNoticeView> = {
  title: 'System/AuditGapNotice',
  component: AuditGapNoticeView,
  parameters: { layout: 'padded' },
  args: { onFill: fn() },
};
export default meta;

type Story = StoryObj<typeof AuditGapNoticeView>;

export const Idle: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const notice = canvas.getByTestId('audit-gap-notice');
    // 唯一有信息量的半句留着：中间漏了多少条**不知道**，列表不许假装连续。
    await expect(notice).toHaveTextContent('这里有一段事件还没加载');
    await expect(notice).toHaveTextContent('条数未知');
    // ⛔ `seq` 是数据库列名，两个内部序号对用户毫无意义（填洞用的 gap 一个字没动）。
    await expect(notice).not.toHaveTextContent('seq');

    await userEvent.click(canvas.getByRole('button', { name: '加载中间部分' }));
    // ⛔ **一次点击 = 一次填充**：自动循环追平在异常风暴下是无界请求，
    //    而且会把用户正在看的位置冲走。
    await expect(args.onFill).toHaveBeenCalledTimes(1);
  },
};

export const Filling: Story = {
  args: { filling: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '加载中…' })).toBeDisabled();
  },
};
