import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AuditGapNoticeView } from '@/views/system/AuditGapNotice.view';

const meta: Meta<typeof AuditGapNoticeView> = {
  title: 'System/AuditGapNotice',
  component: AuditGapNoticeView,
  parameters: { layout: 'padded' },
  args: { afterSeq: 1200, beforeSeq: 1587, onFill: fn() },
};
export default meta;

type Story = StoryObj<typeof AuditGapNoticeView>;

export const Idle: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/此处有未加载的事件/)).toBeInTheDocument();

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
