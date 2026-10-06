import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { ShortcutsView } from '@/views/workbench/Shortcuts.view';

const meta = {
  title: 'Workbench/Shortcuts',
  component: ShortcutsView,
  parameters: { layout: 'fullscreen' },
  args: { onClose: fn(), onCloseAutoFocus: fn() },
} satisfies Meta<typeof ShortcutsView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
