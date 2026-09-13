// F21-6 §7.2：组头两个 variant —— `normal` 与 `cloneFailed`（`● [Folder] 名字 [AlertTriangle] 克隆失败 ⋯`，
// 前导 `●` 是 StatusDot）。
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
    collapsed: false,
    onToggleCollapse: fn(),
    onOpenMenu: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof ProjectGroupHeaderView>;

/**
 * 常规组头 `[Folder] ProjectName · N ⋯`。
 * ⭐ **这一期的立论就在这个 `⋯` 上**：在它之前，删除项目在界面上根本够不着（§10.1）。
 */
export const Normal: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvas.getByTestId('project-group-header');
    await expect(header).toHaveAttribute('data-variant', 'normal');
    // MUTATION：把 `<Folder>` 换回 📁 字符或换成另一个图标 ⇒ 这条先红——只断言
    // 项目名文本（下面 userEvent 那句）不会因为图标变了而变红，锁不住"真的是 Folder"。
    await expect(header.querySelector('svg.lucide-folder')).not.toBeNull();
    await userEvent.click(canvas.getByTestId('project-group-menu-trigger'));
    await expect(args.onOpenMenu).toHaveBeenCalledWith('p1');
  },
};

export const Selected: Story = { args: { selected: true } };

export const Cloning: Story = { args: { cloneStatus: 'cloning' } };

/**
 * `● [Folder] ProjectName [AlertTriangle] 克隆失败 ⋯`（产品 P21-6 §9）。
 * ⭐ 前导徽标是 `StatusDot`（design-notes.md §4 Phase 3 第 2 条），⛔ 不再是手写 emoji——
 * 用 `data-status="fail"` 断言，而不是找一个 emoji 字符（emoji 换成别的视觉表现时这条不该跟着红）。
 * ⚠️ `AlertTriangle` 是 lucide 历史别名，渲染出的 class 是 `lucide-triangle-alert`
 * （不是 `lucide-alert-triangle`）——写错这个名字断言会一直找不到元素。
 */
export const CloneFailed: Story = {
  args: { cloneStatus: 'failed', taskCount: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvas.getByTestId('project-group-header');
    await expect(header).toHaveAttribute('data-variant', 'cloneFailed');
    // emoji 已从文案里拆出：文字断言只锁「克隆失败」，图标另断言 svg class。
    const badge = canvas.getByText('克隆失败');
    await expect(badge).toBeInTheDocument();
    await expect(badge.querySelector('svg.lucide-triangle-alert')).not.toBeNull();
    const dot = header.querySelector('[data-slot="status-dot"]');
    await expect(dot).not.toBeNull();
    await expect(dot).toHaveAttribute('data-status', 'fail');
  },
};

/**
 * ⭐ 折叠箭头是**独立按钮**：点它只切折叠，不触发 `onSelect`（design-notes.md §4
 * Phase 3 / 原型的 chevron）。两个动作分开是刻意的——failed 态项目仍然要能被选中
 * 才能触达恢复面板（见文件头注释），把折叠揉进选中按钮会两头不讨好。
 *
 * 变异：把折叠箭头点击处理器改成同时调用 `onSelect` ⇒ 本例最后一句
 * `onSelect` 未被调用的断言变红。
 */
export const ToggleCollapse: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByTestId('project-group-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    await expect(args.onToggleCollapse).toHaveBeenCalledWith('p1');
    await expect(args.onSelect).not.toHaveBeenCalled();
  },
};

/** 折叠态：箭头旋转 -90°（视觉上指向右），且无障碍态 `aria-expanded=false`。 */
export const Collapsed: Story = {
  args: { collapsed: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByTestId('project-group-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const chevron = toggle.querySelector('svg');
    await expect(chevron?.getAttribute('class')).toContain('-rotate-90');
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
