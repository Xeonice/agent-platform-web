import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { TerminalFrame } from '@/components/ui/terminal-frame';

const meta: Meta<typeof TerminalFrame> = {
  title: 'UI/TerminalFrame',
  component: TerminalFrame,
  parameters: { layout: 'padded' },
  args: {
    style: { height: 160 },
    canvasTestId: 'terminal-frame-canvas',
  },
};
export default meta;

type Story = StoryObj<typeof TerminalFrame>;

// 全局 preview 装饰器把每个 story 包在 `<div className="dark">` 里（产品默认全局暗色，
// P21 §3）。Dark 变体因此不需要额外处理；Light 变体用内联 style 局部覆盖
// --terminal-chrome / --terminal-chrome-border 两个变量，模拟 `:root`（亮色）下的取值，
// 不依赖切主题（隔离此 view 的局部主题）。

/** 暗色壳与画布遵循 v2 token。 */
export const Dark: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const shell = canvas.getByTestId('terminal-frame-canvas').parentElement;
    if (!shell) throw new Error('terminal-shell 节点缺失');
    const shellStyle = getComputedStyle(shell);
    // v2 暗色画布与终端壳使用黑色。
    await expect(shellStyle.backgroundColor).toBe('rgb(0, 0, 0)');
    const canvasEl = canvas.getByTestId('terminal-frame-canvas');
    // 画布恒黑，两套主题都不能碰。
    await expect(getComputedStyle(canvasEl).backgroundColor).toBe('rgb(0, 0, 0)');
  },
};

// CSSProperties 没有声明自定义属性；用一个专门的类型描述这两个变量覆盖，不用 `as` 断言。
interface TerminalChromeVars extends React.CSSProperties {
  '--terminal-chrome': string;
  '--terminal-chrome-border': string;
}

const LIGHT_TERMINAL_CHROME_VARS: TerminalChromeVars = {
  '--terminal-chrome': '#fafafa',
  '--terminal-chrome-border': '#e5e5e5',
};

/** 满幅画布没有圆角、边框或相框留白。 */
export const EdgeToEdgeCanvas: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement).getByTestId('terminal-frame-canvas');
    const shell = canvas.parentElement;
    if (!shell) throw new Error('terminal-shell 节点缺失');
    await expect(getComputedStyle(shell).padding).toBe('0px');
    await expect(getComputedStyle(shell).borderRadius).toBe('0px');
    await expect(getComputedStyle(canvas).borderRadius).toBe('0px');
    await expect(getComputedStyle(canvas).padding).toBe('12px 16px');
  },
};

/** 画布ref目标与容器保持独立；没有额外的相框工具栏行。 */
export const CanvasOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement).getByTestId('terminal-frame-canvas');
    await expect(canvas.parentElement?.children.length).toBe(1);
  },
};

/** 亮色：画布满幅恒黑，无浅色仪表相框（f-wb-live-01）。 */
export const Light: Story = {
  decorators: [
    (Story) => (
      <div style={LIGHT_TERMINAL_CHROME_VARS}>
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const shell = canvas.getByTestId('terminal-frame-canvas').parentElement;
    if (!shell) throw new Error('terminal-shell 节点缺失');
    const shellStyle = getComputedStyle(shell);
    // v2 两套主题的终端画布都恒黑；主题色只用于共享终端栏。
    await expect(shellStyle.backgroundColor).toBe('rgb(0, 0, 0)');
    const canvasEl = canvas.getByTestId('terminal-frame-canvas');
    // 画布恒黑不变——亮色模式下也不能被相框的浅色带偏。
    await expect(getComputedStyle(canvasEl).backgroundColor).toBe('rgb(0, 0, 0)');
  },
};
