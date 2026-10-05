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
  },
};
export default meta;

type Story = StoryObj<typeof ProjectGroupHeaderView>;

export const Normal: Story = {
  args: { menuSlot: <span data-testid="group-menu-slot-probe">⋯</span> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvas.getByTestId('project-group-header');
    await expect(header).toHaveAttribute('data-variant', 'normal');
    await expect(header.querySelector('svg.lucide-folder')).not.toBeNull();
    await expect(header.getBoundingClientRect().height).toBe(32);
    await expect(
      canvas.getByText('acme-web').getBoundingClientRect().left -
        header.getBoundingClientRect().left,
    ).toBe(52);
    const slot = canvas.getByTestId('group-menu-slot-probe');
    await expect(header).toContainElement(slot);
  },
};

export const Selected: Story = {
  args: { selected: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'acme-web，3 个任务' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    const marker = getComputedStyle(canvas.getByTestId('project-group-header'), '::before');
    await expect(marker.width).toBe('2px');
    await expect(marker.height).toBe('16px');
    await expect(marker.top).toBe('8px');
  },
};

export const Cloning: Story = { args: { cloneStatus: 'cloning' } };

/** 失败项目可选中进入恢复面板；折叠按钮保留可访问原因但不执行折叠。 */
export const CloneFailed: Story = {
  args: { cloneStatus: 'failed', taskCount: 0 },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvas.getByTestId('project-group-header');
    await expect(header).toHaveAttribute('data-variant', 'cloneFailed');
    const badge = canvas.getByText('克隆失败');
    await expect(badge).toBeInTheDocument();
    await expect(badge.getBoundingClientRect().height).toBe(20);
    await expect(badge.querySelector('svg')).toBeNull();
    await expect(header.querySelector('[data-slot="status-dot"]')).toBeNull();
    const toggle = canvas.getByTestId('project-group-toggle');
    await expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await expect(getComputedStyle(toggle).cursor).toBe('not-allowed');
    await expect(toggle).toHaveAccessibleDescription('项目克隆失败，先重试克隆或改为空项目');
    await userEvent.click(toggle);
    await expect(args.onToggleCollapse).not.toHaveBeenCalled();
    const select = canvas.getByRole('button', { name: 'acme-web，克隆失败，0 个任务' });
    await expect(select).not.toBeDisabled();
    await userEvent.click(select);
    await expect(args.onSelect).toHaveBeenCalledWith('p1');
    select.focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onSelect).toHaveBeenCalledTimes(2);
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
