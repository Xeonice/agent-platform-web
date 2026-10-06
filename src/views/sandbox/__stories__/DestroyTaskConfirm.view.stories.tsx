import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { DestroyTaskConfirmView } from '../DestroyTaskConfirm.view';
const meta = {
  component: DestroyTaskConfirmView,
  args: {
    name: '迁移构建脚本',
    preparing: false,
    canKeep: true,
    keep: true,
    busy: false,
    onKeep: () => undefined,
    onCancel: () => undefined,
    onConfirm: () => undefined,
  },
} satisfies Meta<typeof DestroyTaskConfirmView>;
export default meta;
export const Running: StoryObj<typeof meta> = {};
export const FirstStartup: StoryObj<typeof meta> = {
  args: { preparing: true, canKeep: false, keep: false },
};
