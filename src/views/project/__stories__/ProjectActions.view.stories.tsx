// F21-6 §10.5「ProjectActions」：这一期只有 [删除] 一个真按钮。
// ⛔ **否定性**：重命名 / 归档**连禁用态都不摆**（§10.2 D + §10.5：一个点不动的按钮比没有更让人困惑）。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { ProjectActionsView } from '@/views/project/ProjectActions.view';

const meta: Meta<typeof ProjectActionsView> = {
  title: 'Project/ProjectActions',
  component: ProjectActionsView,
  parameters: { layout: 'fullscreen' },
  args: { onRequestDelete: fn() },
};
export default meta;

type Story = StoryObj<typeof ProjectActionsView>;

export const OnlyDelete: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('project-delete-entry')).toBeEnabled();
    // ⛔ 占位灰按钮一个都不许有。
    await expect(canvas.queryByText(/重命名/)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/归档/)).not.toBeInTheDocument();
  },
};

/** 删除在途：入口禁用，防连点起两次不可逆操作。 */
export const Busy: Story = { args: { busy: true } };
