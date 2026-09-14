// F21-6 §3.3：项目详情面板（2026-09-14 从 `ProjectMenuPanel` 拆出）。
//
// ⭐ 两条否定断言是本组件存在的理由，⛔ 不能删：
//  ① 面板里**没有任何危险动作**——删除只在 ⋯ 菜单里那一个入口；
//  ② 摘要计数**分得清"不知道"和"真的是 0"**。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ProjectDetailPanelView } from '@/views/project/ProjectDetailPanel.view';

const meta: Meta<typeof ProjectDetailPanelView> = {
  title: 'Project/ProjectDetailPanel',
  component: ProjectDetailPanelView,
  parameters: { layout: 'fullscreen' },
  args: {
    cloneStatus: 'ready',
    taskCount: 5,
    createdAt: '2026-08-01T10:00:00Z',
    retainedCount: 2,
    automationCount: 3,
  },
};
export default meta;

type Story = StoryObj<typeof ProjectDetailPanelView>;

export const Normal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('project-detail-retained-count')).toHaveTextContent('2 项');
    await expect(canvas.getByTestId('project-detail-automation-count')).toHaveTextContent('3 条');
  },
};

/**
 * ⭐ **「不知道」≠「0」**：计数为 `undefined`（加载中 / 取不到）时渲染「—」。
 * 报 0 会让用户以为自己什么都没留下，而实际可能只是还没加载完。
 * 变异：把 view 里的 `countText` 改成 `n ?? 0`（或在 container 里 `?? 0`）⇒ 本条红。
 */
export const CountsUnknownWhileLoading: Story = {
  args: { retainedCount: undefined, automationCount: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('project-detail-retained-count')).toHaveTextContent('—');
    await expect(canvas.getByTestId('project-detail-automation-count')).toHaveTextContent('—');
    // 而且⛔不能长得像 0。
    await expect(canvas.getByTestId('project-detail-retained-count')).not.toHaveTextContent('0');
  },
};

/** 真的是 0：说「0 项」，与上一条的「—」区分得开。 */
export const CountsGenuinelyZero: Story = {
  args: { retainedCount: 0, automationCount: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('project-detail-retained-count')).toHaveTextContent('0 项');
    await expect(canvas.getByTestId('project-detail-automation-count')).toHaveTextContent('0 条');
  },
};

/**
 * ⭐ **面板里没有删除入口，也没有跳转按钮**（2026-09-14 拆分的核心）。
 * 拆分前这里既有 [删除项目…]（与 ⋯ 菜单重复），又有两个跳转入口（把同一个去处散在两层）。
 * 变异：把 [删除项目…] 或任一跳转按钮加回来 ⇒ 本条红。
 */
export const NoDangerousActionsInDetail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId('project-delete-entry')).not.toBeInTheDocument();
    await expect(canvas.queryByText('删除项目…')).not.toBeInTheDocument();
    await expect(canvas.queryByTestId('open-retained-volumes')).not.toBeInTheDocument();
    await expect(canvas.queryByTestId('open-automations')).not.toBeInTheDocument();
    // 整个面板一个按钮都不该有 —— 它只回答"现在什么状况"。
    await expect(canvas.queryAllByRole('button')).toHaveLength(0);
  },
};

/**
 * ⛔ **没有「名称」行**：标题下方已经写着项目名，再列一遍是同一个值占两行（拆分前的毛病）。
 * ⛔ 也没有「来源」行（§6 产品已定）。
 */
export const NoDuplicateNameRow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText('名称')).not.toBeInTheDocument();
    await expect(canvas.queryByText('来源')).not.toBeInTheDocument();
  },
};

/** failed：指路去 ⋯ 菜单的两条出路，⛔ 不在这里再开一个入口。 */
export const CloneFailedShowsWayOut: Story = {
  args: { cloneStatus: 'failed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('project-detail-failed-hint')).toHaveTextContent('重试克隆');
    await expect(canvas.queryByTestId('group-menu-retry-clone')).not.toBeInTheDocument();
  },
};

export const Cloning: Story = { args: { cloneStatus: 'cloning' } };
