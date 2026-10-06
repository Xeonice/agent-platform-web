import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PresetDisableDialogView } from '@/views/image/PresetDisableDialog.view';

const meta = {
  title: 'image/PresetDisableDialog',
  component: PresetDisableDialogView,
  args: {
    reference: 'ghcr.io/agent-infra/sandbox:latest',
    version: 'sha256:8e05…d77',
    busy: false,
    onConfirm: () => undefined,
    onCancel: () => undefined,
  },
} satisfies Meta<typeof PresetDisableDialogView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Disabling: Story = { args: { busy: true } };
