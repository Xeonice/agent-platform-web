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
// 不依赖切主题（Phase 0 明确不做主题切换器）。

/** 暗色（默认）：仪表壳维持 v1 就定下的深色，跟画布本身的黑区分得开但不刺眼。 */
export const Dark: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const shell = canvas.getByTestId('terminal-frame-canvas').parentElement;
    if (!shell) throw new Error('terminal-shell 节点缺失');
    const shellStyle = getComputedStyle(shell);
    // --terminal-chrome 暗色值 #111214 = rgb(17, 18, 20)
    await expect(shellStyle.backgroundColor).toBe('rgb(17, 18, 20)');
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
  '--terminal-chrome': '#e7e7ea',
  '--terminal-chrome-border': '#d3d3d7',
};

/** 亮色：仪表壳改用浅灰相框（问题 4 的核心结论——相框跟随主题，画心恒黑不变）。 */
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
    // --terminal-chrome 亮色值 #e7e7ea = rgb(231, 231, 234)
    await expect(shellStyle.backgroundColor).toBe('rgb(231, 231, 234)');
    const canvasEl = canvas.getByTestId('terminal-frame-canvas');
    // 画布恒黑不变——亮色模式下也不能被相框的浅色带偏。
    await expect(getComputedStyle(canvasEl).backgroundColor).toBe('rgb(0, 0, 0)');
  },
};
