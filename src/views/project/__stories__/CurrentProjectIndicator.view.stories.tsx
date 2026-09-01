// F21-6 §7.2 / §9.1 #2：顶部指示器**只读**，点击只做树内定位。
// ⛔ **否定性 play**：没有下拉（`aria-haspopup` 不存在），也不承载创建/管理入口。
// 名字是文本、定位是按钮（理由见 view 文件头：避免与左侧树组头按钮同名撞车）。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { CurrentProjectIndicatorView } from '@/views/project/CurrentProjectIndicator.view';

const meta: Meta<typeof CurrentProjectIndicatorView> = {
  title: 'Project/CurrentProjectIndicator',
  component: CurrentProjectIndicatorView,
  parameters: { layout: 'fullscreen' },
  args: { projectName: 'acme-web', onLocate: fn() },
};
export default meta;

type Story = StoryObj<typeof CurrentProjectIndicatorView>;

export const HasProject: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const indicator = canvas.getByTestId('current-project-indicator');
    await expect(indicator).toHaveTextContent('acme-web');
    // ⛔ 不是下拉：这是 §9.1 #2 的否定性验收（指示器上一个 haspopup 都不许有）。
    await expect(canvas.queryByRole('button', { expanded: true })).not.toBeInTheDocument();
    const locate = canvas.getByTestId('locate-current-project');
    await expect(locate).not.toHaveAttribute('aria-haspopup');
    await userEvent.click(locate);
    await expect(args.onLocate).toHaveBeenCalled();
  },
};

/** 未选择项目（冷启动 / 当前项目刚被删除后的回落态）。 */
export const NoProject: Story = {
  args: { projectName: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('未选择项目')).toBeInTheDocument();
  },
};
