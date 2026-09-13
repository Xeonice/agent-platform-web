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

    // ⚠️ **图标要锁到具体是哪一个组件，⛔ 不能只锁文字**：上面两条文字断言在
    //    「⚠️ emoji」「lucide 图标」「什么都不放」三种写法下**全都绿**——这个项目里
    //    这类假绿已经实测到五次。
    // ⚠️ class 按**实际渲染**写：lucide 的 `AlertTriangle` 渲染出来是 `lucide-triangle-alert`
    //    （历史别名），⛔ 别照组件名猜成 `lucide-alert-triangle`。
    await expect(notice.querySelector('svg.lucide-triangle-alert')).not.toBeNull();
    // ⛔ 也不许倒退回 emoji。
    await expect(notice.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);

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
