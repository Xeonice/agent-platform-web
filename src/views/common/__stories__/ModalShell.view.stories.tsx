import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ModalShellView } from '@/views/common/ModalShell.view';

const noop = (): void => undefined;

const meta: Meta<typeof ModalShellView> = {
  title: 'Common/ModalShell',
  component: ModalShellView,
  parameters: { layout: 'fullscreen' },
  args: {
    title: '新建任务',
    onClose: noop,
    testId: 'modal-new-task',
    children: <div className="p-6 text-sm text-muted-foreground">弹层内容插槽</div>,
  },
};
export default meta;

type Story = StoryObj<typeof ModalShellView>;

/** 「新建任务」形态：标题 + 上下文副标题（任务归属继承左侧树选中项目，§9.0）。 */
export const NewTask: Story = { args: { subtitle: '在「ProjectA」中发起' } };

/**
 * 「新建项目」形态。**与上一条逐像素同形**——本轮要修的病根就是"两个新建动作长得不一样"
 *（新建项目此前是主区换页、新建任务连入口都没有，F21-2 §N.0）。
 */
export const NewProject: Story = { args: { title: '新建项目', testId: 'modal-new-project' } };

/** 进行中：[✕] 与遮罩点击都不生效（误关会留下一个用户以为没发生过的请求）。 */
export const Busy: Story = { args: { busy: true, subtitle: '正在创建…' } };
