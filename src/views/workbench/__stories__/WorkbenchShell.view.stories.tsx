import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { WorkbenchShellView } from '@/views/workbench/WorkbenchShell.view';
import type { ProjectGroup } from '@/types/domain';

const groups: ProjectGroup[] = [
  {
    projectId: 'p1',
    projectName: 'acme-web',
    cloneStatus: 'ready',
    collapsed: false,
    taskCount: 2,
    tasks: [
      {
        id: 'running',
        projectId: 'p1',
        name: '运行中的任务',
        status: 'running',
        rawStatus: 'running',
        waitingInput: false,
        lastActiveAt: 2,
      },
      {
        id: 'waiting',
        projectId: 'p1',
        name: '等待确认',
        status: 'running',
        rawStatus: 'running',
        waitingInput: true,
        lastActiveAt: 1,
      },
    ],
  },
];
const meta: Meta<typeof WorkbenchShellView> = {
  title: 'Workbench/WorkbenchShell',
  component: WorkbenchShellView,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="h-screen">{Story()}</div>],
  args: { groups, waitingInputCount: 1, healthLabel: null, terminalSlot: <div>当前任务内容</div> },
};
export default meta;
type Story = StoryObj<typeof WorkbenchShellView>;

export const SharedNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const [name, href] of [
      ['任务', '/'],
      ['凭证管理', '/settings/credentials'],
      ['镜像管理', '/settings/images'],
      ['系统状态', '/settings/system'],
    ]) {
      await expect(canvas.getByRole('link', { name })).toHaveAttribute('href', href);
    }
    await expect(canvas.getByText('当前任务内容')).toBeInTheDocument();
  },
};
export const WaitingCountOnTaskNavigation: Story = {
  args: { waitingInputCount: 3 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: '任务' })).toHaveTextContent('3');
  },
};
export const WaitingStatusUsesItsOwnTone: Story = {
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByRole('button', { name: /等待确认/ });
    await expect(row.querySelector('[data-slot="status-dot"]')).toHaveAttribute(
      'data-status',
      'info',
    );
    await expect(row).toHaveTextContent('等待确认');
  },
};
export const FindOpensSharedPalette: Story = {
  args: { onFind: fn() },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: '查找任务、项目与动作（⌘K）' }),
    );
    await expect(args.onFind).toHaveBeenCalledOnce();
  },
};
export const StatusFilterMenu: Story = {
  args: { statusFilter: 'running', onStatusFilterChange: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '按状态筛选任务' }));
    const menu = within(document.body);
    await expect(await menu.findByRole('menuitemradio', { name: /^运行中$/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(menu.getByRole('menuitemradio', { name: /^等待输入$/ }));
    await expect(args.onStatusFilterChange).toHaveBeenCalledWith('waitingInput');
  },
};
export const ClearActiveFilter: Story = {
  args: { statusFilter: 'error', onStatusFilterChange: fn() },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '移除筛选：异常' }));
    await expect(args.onStatusFilterChange).toHaveBeenCalledWith('all');
  },
};
export const TaskSelection: Story = {
  args: { onSelectTask: fn() },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /运行中的任务/ }));
    await expect(args.onSelectTask).toHaveBeenCalledWith('running');
  },
};
export const ProjectFoldDoesNotSelect: Story = {
  args: { onToggleGroupCollapse: fn(), onSelectProject: fn() },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByTestId('project-group-toggle'));
    await expect(args.onToggleGroupCollapse).toHaveBeenCalledWith('p1');
    await expect(args.onSelectProject).not.toHaveBeenCalled();
  },
};
export const LoadingHasNoInteractiveTaskEntry: Story = {
  args: { isLoading: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('new-task-entry')).toBeDisabled();
  },
};
export const TaskEntryExplainsPrerequisite: Story = {
  args: { newTaskDisabledReason: '先新建一个项目', onNewTask: fn() },
  play: async ({ canvasElement, args }) => {
    const entry = within(canvasElement).getByTestId('new-task-entry');
    await expect(entry).toHaveAttribute('aria-disabled', 'true');
    await expect(entry).toHaveAttribute('aria-describedby', 'new-task-disabled-reason');
    await userEvent.click(entry);
    await expect(args.onNewTask).not.toHaveBeenCalled();
  },
};
export const CollapseKeepsFindAndNavigation: Story = {
  args: { sidebarCollapsed: true, onToggleSidebar: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.queryByRole('navigation', { name: '项目分组任务树' }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: '查找任务、项目与动作（⌘K）' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '展开侧栏' }));
    await expect(args.onToggleSidebar).toHaveBeenCalledOnce();
  },
};
export const ThemeMenu: Story = {
  args: { theme: 'dark', onThemeChange: fn() },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '外观' }));
    const menu = within(document.body);
    await userEvent.click(await menu.findByRole('menuitemradio', { name: '亮色' }));
    await expect(args.onThemeChange).toHaveBeenCalledWith('light');
  },
};
