import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { TerminalToolbarView } from '@/views/terminal/TerminalToolbar.view';

const meta: Meta<typeof TerminalToolbarView> = {
  title: 'Terminal/TerminalToolbar',
  component: TerminalToolbarView,
  args: {
    breadcrumb: 'ProjectA / Codex · 重构支付模块的类型定义',
    onCopy: fn(),
    onClear: fn(),
    onDecreaseFontSize: fn(),
    onIncreaseFontSize: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof TerminalToolbarView>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('terminal-toolbar-breadcrumb')).toHaveTextContent(
      'ProjectA / Codex · 重构支付模块的类型定义',
    );
  },
};

/** 四个按钮各自触发各自的回调，不是共用一个空壳。 */
export const ButtonsEachCallOwnHandler: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('terminal-toolbar-copy'));
    await expect(args.onCopy).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByTestId('terminal-toolbar-clear'));
    await expect(args.onClear).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByTestId('terminal-toolbar-font-decrease'));
    await expect(args.onDecreaseFontSize).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByTestId('terminal-toolbar-font-increase'));
    await expect(args.onIncreaseFontSize).toHaveBeenCalledTimes(1);
    // 点复制/清屏不该顺带触发字号回调（反之亦然）——四个按钮互不串线。
    await expect(args.onCopy).toHaveBeenCalledTimes(1);
  },
};

/** 字号到下限时 [A-] 置灰，⛔ 不是无提示地点了没反应。 */
export const FontSizeAtLowerBound: Story = {
  args: { canDecreaseFontSize: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('terminal-toolbar-font-decrease')).toBeDisabled();
    await expect(canvas.getByTestId('terminal-toolbar-font-increase')).toBeEnabled();
  },
};

export const FontSizeAtUpperBound: Story = {
  args: { canIncreaseFontSize: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('terminal-toolbar-font-increase')).toBeDisabled();
  },
};
