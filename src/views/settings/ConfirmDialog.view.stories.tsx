import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ConfirmDialogView } from '@/views/settings/ConfirmDialog.view';

const noop = (): void => undefined;

const meta: Meta<typeof ConfirmDialogView> = {
  title: 'Settings/ConfirmDialog',
  component: ConfirmDialogView,
  args: {
    title: '切换生效模式',
    message: '切换后新任务将使用 API Key（按量计费），已运行任务不受影响。',
    confirmLabel: '切换',
    onConfirm: noop,
    onCancel: noop,
  },
};
export default meta;

type Story = StoryObj<typeof ConfirmDialogView>;

export const SwitchMode: Story = {};

export const Busy: Story = { args: { busy: true } };
