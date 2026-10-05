import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { DeleteAutomationConfirmView } from '@/views/project/DeleteAutomationConfirm.view';

const meta: Meta<typeof DeleteAutomationConfirmView> = {
  title: 'Project/DeleteAutomationConfirm',
  component: DeleteAutomationConfirmView,
  args: {
    name: '每天凌晨跑一遍回归',
    busy: false,
    onCancel: fn(),
    onDelete: fn(),
    preview: { runCount: 42, artifactCount: 3, runningTasks: [{ id: 'sbx-1', name: '自动回归' }] },
  },
};
export default meta;
type Story = StoryObj<typeof DeleteAutomationConfirmView>;
export const AuthoritativeCounts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('detail-delete-confirm')).toHaveTextContent('42 次运行历史');
    await expect(canvas.getByTestId('detail-delete-confirm')).toHaveTextContent('3 份运行成果');
    await expect(canvas.getByTestId('detail-delete-confirm')).toHaveTextContent('自动回归');
    await expect(canvas.getByRole('button', { name: '取消' })).toHaveFocus();
  },
};
export const UnknownCounts: Story = {
  args: { preview: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('detail-delete-confirm')).toHaveTextContent(
      '全部运行历史',
    );
  },
};
export const Deleting: Story = {
  args: { busy: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '正在删除…' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: '取消' })).toBeDisabled();
  },
};
