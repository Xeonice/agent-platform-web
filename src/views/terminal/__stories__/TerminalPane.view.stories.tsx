import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { TerminalPaneView } from '@/views/terminal/TerminalPane.view';

const meta: Meta<typeof TerminalPaneView> = {
  title: 'Terminal/TerminalPane',
  component: TerminalPaneView,
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof TerminalPaneView>;

// 实例活在 registry（08 §7.4），view 只持 div ref；story 展示空态与容器骨架。
export const Empty: Story = { args: { empty: true } };
export const ContainerOnly: Story = { args: { empty: false } };
