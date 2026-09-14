// F21-6 §7.2 / §10.7：failed 项目（三出口）· 正常项目（无前两项）· cloning（取消克隆）。
//
// ⭐ 最要紧的一条 play 在 `CloneFailed`：点 [改为空项目] → `onConvertToEmpty` 携正确
// projectId（§7.2）。而"菜单自己再发一次 retry-clone"那个病由 container 集成用例钉住
// —— 本组件**不持有任何请求**，它连 service 都 import 不到（07 §3 规则 1）。
//
// ⚠️ 菜单换成 shadcn `DropdownMenu` 之后内容挂在 Radix `Portal` 上，**不在 canvasElement 里**
// ⇒ 断言一律走 `within(document.body)`（与 `SettingsMenuOpensWithThreeItems` 同一条纪律）。
// 这些 story 直接给 `open: true`，省掉每条都先点一次触发器。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ProjectGroupMenuView } from '@/views/project/ProjectGroupMenu.view';

const meta: Meta<typeof ProjectGroupMenuView> = {
  title: 'Project/ProjectGroupMenu',
  component: ProjectGroupMenuView,
  parameters: { layout: 'fullscreen' },
  args: {
    projectId: 'p1',
    projectName: 'acme-web',
    cloneStatus: 'ready',
    open: true,
    onOpenChange: fn(),
    onOpenDetail: fn(),
    onOpenRetainedVolumes: fn(),
    onOpenAutomations: fn(),
    onRetryClone: fn(),
    onConvertToEmpty: fn(),
    onCancelClone: fn(),
    onRequestDelete: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof ProjectGroupMenuView>;

/** 正常项目：**无**前两项（重试/改空是 failed 专属），也没有取消克隆。 */
export const Normal: Story = {
  play: async ({ args }) => {
    const body = within(document.body);
    await expect(body.queryByTestId('group-menu-retry-clone')).not.toBeInTheDocument();
    await expect(body.queryByTestId('group-menu-convert-to-empty')).not.toBeInTheDocument();
    await expect(body.queryByTestId('group-menu-cancel-clone')).not.toBeInTheDocument();

    await userEvent.click(body.getByTestId('group-menu-open-detail'));
    await expect(args.onOpenDetail).toHaveBeenCalled();
  },
};

/**
 * ⭐ **三个去处都在这一层，点一次就到**（2026-09-14 拍平二级面板）。
 *
 * 旧结构是 `⋯` → 一项叫「项目菜单…」→ 侧弹层里才有这三项，到自动化规则要点三次。
 * 变异：把任意一项挪回二级面板（即本层不再渲染它）⇒ 对应断言红。
 */
export const AllDestinationsAreOneClickAway: Story = {
  play: async ({ args }) => {
    const body = within(document.body);
    await userEvent.click(body.getByTestId('group-menu-open-retained'));
    await expect(args.onOpenRetainedVolumes).toHaveBeenCalled();
    await userEvent.click(body.getByTestId('group-menu-open-automations'));
    await expect(args.onOpenAutomations).toHaveBeenCalled();
  },
};

/**
 * ⭐ **否定断言：菜单里不再有一个叫「项目菜单」的项，删除也只有一个入口。**
 *
 * 这两条是本次重构要修掉的病，⛔ 不能只靠"新项都在"的肯定断言 —— 把旧的
 * 「项目菜单…」中转项加回来、或在二级面板里再挂一个删除，肯定断言全都还是绿的。
 */
export const NoSelfReferentialItemAndSingleDeleteEntry: Story = {
  play: async () => {
    const body = within(document.body);
    // 旧的中转项：testid 与可见文案两头都不许再出现。
    await expect(body.queryByTestId('group-menu-open-panel')).not.toBeInTheDocument();
    await expect(body.queryByText('项目菜单…')).not.toBeInTheDocument();
    // 删除入口全局唯一。
    await expect(body.queryAllByTestId('group-menu-delete')).toHaveLength(1);
  },
};

/** failed 三出口：[重试克隆] / [改为空项目] / [删除]（§6 状态矩阵最后一行）。 */
export const CloneFailed: Story = {
  args: { cloneStatus: 'failed' },
  play: async ({ args }) => {
    const body = within(document.body);
    await expect(body.getByTestId('group-menu-retry-clone')).toBeInTheDocument();
    await expect(body.getByTestId('group-menu-delete')).toBeInTheDocument();

    await userEvent.click(body.getByTestId('group-menu-convert-to-empty'));
    await expect(args.onConvertToEmpty).toHaveBeenCalled();
  },
};

/**
 * cloning：[取消克隆（保留项目）] 与 [删除项目…] **同时在场且文案不像**（§10.6 第 2 条）。
 * 两句话像了，用户就会拿删除当"取消"用——而那是不可逆的。
 */
export const Cloning: Story = {
  args: { cloneStatus: 'cloning' },
  play: async () => {
    const body = within(document.body);
    await expect(body.getByTestId('group-menu-cancel-clone')).toHaveTextContent(
      '取消克隆（保留项目）',
    );
    await expect(body.getByTestId('group-menu-delete')).toHaveTextContent('删除项目…');
  },
};

/** 动作在途：三出口禁用；失败原因就地显示（⛔ 不静默吞掉）。 */
export const BusyWithError: Story = {
  args: { cloneStatus: 'failed', busy: true, actionError: '该项目无需转换（当前不是失败态）。' },
};

/** 收起态：只剩触发器，菜单内容不在 DOM 里。 */
export const Closed: Story = {
  args: { open: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('project-group-menu-trigger')).toBeInTheDocument();
    await expect(within(document.body).queryByTestId('group-menu-delete')).not.toBeInTheDocument();
  },
};
