import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
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

/** `toolbar` 原样转发给 `TerminalFrame` 的同名插槽（design-notes.md §4 Phase 3）。 */
export const WithToolbar: Story = {
  args: { toolbar: <div data-testid="toolbar-probe">工具栏</div> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('toolbar-probe')).toBeInTheDocument();
  },
};
