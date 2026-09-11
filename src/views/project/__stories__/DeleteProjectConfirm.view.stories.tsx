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

/**
 * 无运行中任务：三行后果都在，警示句说的是"当前没有运行中的任务"（不沉默）。
 *
 * ★ **三行一条都不许省**：会删掉 / 会留下（含「远端 Git 仓库不受影响」）/ 删掉之后拿不回来。
 *   旧文案是一句话，把最重要的「留了什么」塞进括号，而且一个字都没说远端仓库不受影响
 *   —— 那是开发者按下去之前最想确认的第一件事。
 */
export const NoRunningTasks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const cascade = canvas.getByTestId('delete-cascade-copy');
    await expect(cascade).toHaveTextContent('会删掉');
    await expect(cascade).toHaveTextContent('5 个任务');
    await expect(cascade).toHaveTextContent('会留下');
    await expect(cascade).toHaveTextContent('远端 Git 仓库不受影响');
    await expect(cascade).toHaveTextContent('删掉之后');
    await expect(cascade).toHaveTextContent('拿不回来');
    // ⛔ 界面上别处没有的词不许出现在这里（用户没法把「成果卷」和菜单里那一项对上）。
    await expect(cascade.textContent).not.toContain('成果卷');
    await expect(cascade.textContent).not.toContain('数据卷');
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
    await expect(warning).toHaveTextContent('其中 2 个任务正在跑，会被强制停下');
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
    await expect(note).toHaveTextContent('先停掉这次克隆');
    await expect(note).toHaveTextContent('取消克隆（保留项目）');
  },
};

/** 后端拒绝（如 409 有运行中任务）：**留在原地**把原因说出来，⛔ 不静默关闭（§10.7 集成 ③）。 */
export const Rejected: Story = {
  args: { runningTaskCount: 2, errorMessage: '该项目仍有运行中的任务，请先停止后再删除。' },
};

/** 删除在途：两个按钮都禁用。 */
export const Deleting: Story = { args: { busy: true } };
