import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within, userEvent, waitFor } from 'storybook/test';
import { ContractFinalizeView } from '@/views/system/ContractFinalize.view';
const eligible = {
  visible: true,
  canExecute: true,
  status: '旧格式可清理',
  reason: null,
  facts: [{ label: '数据表示', value: '项目名称 → 当前显示名称' }],
};
const meta: Meta<typeof ContractFinalizeView> = {
  title: 'System/ContractFinalize',
  component: ContractFinalizeView,
  args: {
    model: eligible,
    busy: false,
    confirmationOpen: false,
    onConfirmationOpenChange: fn(),
    onConfirm: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof ContractFinalizeView>;
export const Eligible: Story = {
  play: async ({ canvasElement, args }) => {
    await expect(args.onConfirm).not.toHaveBeenCalled();
    await userEvent.click(within(canvasElement).getByRole('button', { name: '清理旧数据格式' }));
    await expect(args.onConfirmationOpenChange).toHaveBeenCalledWith(true);
    await expect(args.onConfirm).not.toHaveBeenCalled();
  },
};
export const ReadOnly: Story = {
  args: { model: { ...eligible, canExecute: false, status: '旧格式状态只读' } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).queryByRole('button', { name: '清理旧数据格式' }),
    ).toBeNull();
  },
};
export const Confirmation: Story = {
  args: { confirmationOpen: true },
  play: async ({ args }) => {
    const dialog = within(document.body).getByRole('dialog');
    await waitFor(async () => {
      await expect(
        within(dialog).getByText('清理完成后，使用旧数据格式的历史版本无法重新接流。'),
      ).toBeVisible();
    });
    await expect(args.onConfirm).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: '确认清理' }));
    await expect(args.onConfirm).toHaveBeenCalledOnce();
  },
};
export const Unknown: Story = {
  args: {
    model: {
      ...eligible,
      canExecute: false,
      status: '清理结果待确认',
      reason: '仅查询原请求，不重复执行',
    },
  },
};
