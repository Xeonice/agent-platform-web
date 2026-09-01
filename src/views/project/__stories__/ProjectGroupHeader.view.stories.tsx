// F21-6 §7.2：组头两个 variant —— `normal` 与 `cloneFailed`（`🔴 📁 名字 ⚠️ 克隆失败 ⋯`）。
//
// ⚠️ §7.2 原本还要求一条否定性 play：「failed 态点组头 → 只触发 onToggleFold，
// `onSelectProject` 未被调用」。**本实现刻意不满足它**，理由见 view 文件头：
// 恢复面板（§10.2 A 裁决"留在原地不动"）正是靠"选中失败项目"渲染出来的，挡掉选中
// 就把 P0-1 那条通路断了。这条偏离已回填文档。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ProjectGroupHeaderView } from '@/views/project/ProjectGroupHeader.view';

const meta: Meta<typeof ProjectGroupHeaderView> = {
  title: 'Project/ProjectGroupHeader',
  component: ProjectGroupHeaderView,
  parameters: { layout: 'fullscreen' },
  args: {
    projectId: 'p1',
    projectName: 'acme-web',
    taskCount: 3,
    cloneStatus: 'ready',
    selected: false,
    onSelect: fn(),
    onOpenMenu: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof ProjectGroupHeaderView>;

/**
 * 常规组头 `📁 ProjectName · N ⋯`。
 * ⭐ **这一期的立论就在这个 `⋯` 上**：在它之前，删除项目在界面上根本够不着（§10.1）。
 */
export const Normal: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('project-group-header')).toHaveAttribute(
      'data-variant',
      'normal',
    );
    await userEvent.click(canvas.getByTestId('project-group-menu-trigger'));
    await expect(args.onOpenMenu).toHaveBeenCalledWith('p1');
  },
};

export const Selected: Story = { args: { selected: true } };

export const Cloning: Story = { args: { cloneStatus: 'cloning' } };

/** `🔴 📁 ProjectName ⚠️ 克隆失败 ⋯`（产品 P21-6 §9）。 */
export const CloneFailed: Story = {
  args: { cloneStatus: 'failed', taskCount: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('project-group-header')).toHaveAttribute(
      'data-variant',
      'cloneFailed',
    );
    await expect(canvas.getByText('⚠️ 克隆失败')).toBeInTheDocument();
  },
};

/** 菜单展开时：`aria-expanded=true` + 菜单本体由 container 经 `menuSlot` 插入。 */
export const MenuOpen: Story = {
  args: {
    menuSlot: (
      <div
        role="menu"
        className="absolute right-0 top-full z-20 mt-1 w-40 rounded border border-border bg-background p-1 text-xs"
      >
        菜单插槽
      </div>
    ),
  },
};
