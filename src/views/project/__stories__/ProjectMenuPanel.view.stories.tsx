// F21-6 §7.2 / §10.7：normal / cloning / cloneFailed 三态 + 删除确认视图。
//
// ⛔ **否定性（§7.2 play）**：所有 variant 断言面板内**不存在「来源」行**，
// 且 DOM 全文不含 mock 的 git URL —— "转空之后来源显示什么"这个问题在 UI 上不存在（§6）。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ProjectMenuPanelView } from '@/views/project/ProjectMenuPanel.view';

const meta: Meta<typeof ProjectMenuPanelView> = {
  title: 'Project/ProjectMenuPanel',
  component: ProjectMenuPanelView,
  parameters: { layout: 'fullscreen' },
  args: {
    projectName: 'acme-web',
    cloneStatus: 'ready',
    taskCount: 5,
    createdAt: '2026-08-01T09:30:00.000Z',
    runningTaskCount: 0,
    confirmingDelete: false,
    deleting: false,
    onRequestDelete: fn(),
    onCancelDelete: fn(),
    onConfirmDelete: fn(),
    onOpenRetainedVolumes: fn(),
    onOpenAutomations: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof ProjectMenuPanelView>;

/**
 * 常规项目。play 钉三条：
 * ① 两个搬家来的入口在这里（不在只读条上，§10.2 C）；
 * ② [删除] 走 `onRequestDelete`（先确认，绝不直接删）；
 * ③ **没有「来源」行**、DOM 里没有 git URL。
 */
export const Normal: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('open-retained-volumes')).toBeInTheDocument();
    await expect(canvas.getByTestId('open-automations')).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId('project-delete-entry'));
    await expect(args.onRequestDelete).toHaveBeenCalled();

    await expect(canvas.queryByText('来源')).not.toBeInTheDocument();
    await expect(canvasElement.textContent).not.toContain('github.com');
  },
};

/** git 来源项目：**仍然不显示来源**（本组件根本不接 repoUrl，这条在类型上就成立）。 */
export const GitSourced: Story = {
  args: { projectName: 'acme-web（git 克隆）', taskCount: 12 },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.textContent).not.toContain('github.com');
    await expect(within(canvasElement).queryByText('来源')).not.toBeInTheDocument();
  },
};

export const Cloning: Story = { args: { cloneStatus: 'cloning', taskCount: 0 } };

export const CloneFailed: Story = { args: { cloneStatus: 'failed', taskCount: 2 } };

/** 删除确认视图：面板内**切换**，不是第二层弹层（modal 不堆叠）。 */
export const ConfirmingDelete: Story = {
  args: { confirmingDelete: true, runningTaskCount: 2 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('delete-project-confirm')).toBeInTheDocument();
    // 切到确认视图后，两个入口与 [删除] 入口都不在了（同屏两套动作会让人误点）。
    await expect(canvas.queryByTestId('project-delete-entry')).not.toBeInTheDocument();
    await expect(canvas.queryByTestId('open-retained-volumes')).not.toBeInTheDocument();
  },
};
