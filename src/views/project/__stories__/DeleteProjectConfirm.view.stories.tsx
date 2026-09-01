// F21-6 §10.7 Storybook 行：无运行任务 / 有 N 个运行任务 / cloning 态（文案含「先取消克隆」）。
//
// ⭐ 这三个 variant 存在的理由不是"多几个 story"，而是 §10.6 第 3 条那条纪律：
// 运行中任务警示**读真数据**。0 与 2 必须长得不一样——如果两个 variant 渲染出同一句话，
// 那句话就是"可能有正在运行的任务"，永远正确因而永远没用。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { DeleteProjectConfirmView } from '@/views/project/DeleteProjectConfirm.view';

const meta: Meta<typeof DeleteProjectConfirmView> = {
  title: 'Project/DeleteProjectConfirm',
  component: DeleteProjectConfirmView,
  parameters: { layout: 'fullscreen' },
  args: {
    projectName: 'acme-web',
    taskCount: 5,
    runningTaskCount: 0,
    cloning: false,
    onConfirm: fn(),
    onCancel: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof DeleteProjectConfirmView>;

/** 无运行中任务：级联句在，警示句说的是"当前没有运行中的任务"（不沉默）。 */
export const NoRunningTasks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('delete-cascade-copy')).toHaveTextContent(
      '将删除该项目下 5 个 Task 及其数据卷（保留的成果卷除外），不可逆。',
    );
    await expect(canvas.getByTestId('delete-running-warning')).toHaveTextContent(
      '当前没有运行中的任务',
    );
    // 非 cloning ⇒ 不出现「先取消克隆」那句（两项文案不能像，§10.6 第 2 条）。
    await expect(canvas.queryByTestId('delete-cloning-note')).not.toBeInTheDocument();
  },
};

/** 含 2 个运行中任务：**追加**强制停止文案（§9.1 #16）。 */
export const TwoRunningTasks: Story = {
  args: { runningTaskCount: 2 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const warning = canvas.getByTestId('delete-running-warning');
    await expect(warning).toHaveTextContent('含 2 个运行中任务将被强制停止');
    await expect(warning).toHaveAttribute('role', 'alert');
  },
};

/**
 * cloning 态：删除是**两步**（先取消克隆、再删项目）。
 * ⭐ 同时钉住"这不是取消克隆"：文案里明写另一条路叫 [取消克隆（保留项目）]。
 */
export const WhileCloning: Story = {
  args: { cloning: true, taskCount: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const note = canvas.getByTestId('delete-cloning-note');
    await expect(note).toHaveTextContent('先取消克隆');
    await expect(note).toHaveTextContent('取消克隆（保留项目）');
  },
};

/** 后端拒绝（如 409 有运行中任务）：**留在原地**把原因说出来，⛔ 不静默关闭（§10.7 集成 ③）。 */
export const Rejected: Story = {
  args: { runningTaskCount: 2, errorMessage: '该项目仍有运行中的任务，请先停止后再删除。' },
};

/** 删除在途：两个按钮都禁用。 */
export const Deleting: Story = { args: { busy: true } };
