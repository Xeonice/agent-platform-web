// F21-6 §3「ProjectMetaSection」：名称/状态/任务数/创建时间。
// ⛔ **否定性**：三个 variant 都断言面板内**不存在「来源」行**，且 DOM 全文不含 git URL（§7.2）。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ProjectMetaSectionView } from '@/views/project/ProjectMetaSection.view';

const meta: Meta<typeof ProjectMetaSectionView> = {
  title: 'Project/ProjectMetaSection',
  component: ProjectMetaSectionView,
  parameters: { layout: 'fullscreen' },
  args: {
    projectName: 'acme-web',
    cloneStatus: 'ready',
    taskCount: 5,
    createdAt: '2026-08-01T09:30:00.000Z',
  },
};
export default meta;

type Story = StoryObj<typeof ProjectMetaSectionView>;

/** 就绪态。play 钉住否定性规格：没有「来源」这一行。 */
export const Ready: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('就绪')).toBeInTheDocument();
    await expect(canvas.getByText('5')).toBeInTheDocument();
    await expect(canvas.queryByText('来源')).not.toBeInTheDocument();
    await expect(canvasElement.textContent).not.toContain('github.com');
  },
};

export const Cloning: Story = { args: { cloneStatus: 'cloning', taskCount: 0 } };

/** failed 项目**仍然留在树里、仍有项目菜单**（先落库语义，§2）。 */
export const CloneFailed: Story = { args: { cloneStatus: 'failed', taskCount: 2 } };
