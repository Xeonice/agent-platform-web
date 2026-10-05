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

/**
 * ⭐ `toolbar` 是本轮新增的**可选**插槽（design-notes.md §4 Phase 3）：不传时
 * 一个字节都不多渲染（见 `Dark`/`Light` 两条既有 story 不受影响）；传了就渲染在
 * 画布上方、仪表壳内部——⛔ 不是外层另包一层，那样就不算"壳里的工具栏"了。
 */
export const WithToolbar: Story = {
  args: {
    toolbar: <div data-testid="toolbar-slot-probe">工具栏插槽</div>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const probe = canvas.getByTestId('toolbar-slot-probe');
    const canvasEl = canvas.getByTestId('terminal-frame-canvas');
    const shell = canvasEl.parentElement;
    if (!shell) throw new Error('terminal-shell 节点缺失');
    // 工具栏与画布是**同一个仪表壳内的兄弟节点**，不是画布之外单独一层。
    await expect(probe.parentElement).toBe(shell);
    await expect(canvasEl.parentElement).toBe(shell);
  },
};

/** 不传 `toolbar`（默认）⇒ 插槽不渲染——新增 prop 对既有消费方零影响。 */
export const WithoutToolbar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId('toolbar-slot-probe')).not.toBeInTheDocument();
  },
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
    // v2 亮色画布 #fafafa，终端内容仍为黑色。
    await expect(shellStyle.backgroundColor).toBe('rgb(250, 250, 250)');
    const canvasEl = canvas.getByTestId('terminal-frame-canvas');
    // 画布恒黑不变——亮色模式下也不能被相框的浅色带偏。
    await expect(getComputedStyle(canvasEl).backgroundColor).toBe('rgb(0, 0, 0)');
  },
};
