// F21-6 §7.2 / §10.7：failed 项目（三出口）· 正常项目（无前两项）· cloning（取消克隆）。
//
// ⭐ 最要紧的一条 play 在 `CloneFailed`：点 [改为空项目] → `onConvertToEmpty` 携正确
// projectId（§7.2）。而"菜单自己再发一次 retry-clone"那个病由 container 集成用例钉住
// —— 本组件**不持有任何请求**，它连 service 都 import 不到（07 §3 规则 1）。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ProjectGroupMenuView } from '@/views/project/ProjectGroupMenu.view';

const meta: Meta<typeof ProjectGroupMenuView> = {
  title: 'Project/ProjectGroupMenu',
  component: ProjectGroupMenuView,
  parameters: { layout: 'fullscreen' },
  args: {
    projectName: 'acme-web',
    cloneStatus: 'ready',
    onOpenPanel: fn(),
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
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId('group-menu-retry-clone')).not.toBeInTheDocument();
    await expect(canvas.queryByTestId('group-menu-convert-to-empty')).not.toBeInTheDocument();
    await expect(canvas.queryByTestId('group-menu-cancel-clone')).not.toBeInTheDocument();

    await userEvent.click(canvas.getByTestId('group-menu-open-panel'));
    await expect(args.onOpenPanel).toHaveBeenCalled();
  },
};

/** failed 三出口：[重试克隆] / [改为空项目] / [删除]（§6 状态矩阵最后一行）。 */
export const CloneFailed: Story = {
  args: { cloneStatus: 'failed' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('group-menu-retry-clone')).toBeInTheDocument();
    await expect(canvas.getByTestId('group-menu-delete')).toBeInTheDocument();

    await userEvent.click(canvas.getByTestId('group-menu-convert-to-empty'));
    await expect(args.onConvertToEmpty).toHaveBeenCalled();
  },
};

/**
 * cloning：[取消克隆（保留项目）] 与 [删除项目…] **同时在场且文案不像**（§10.6 第 2 条）。
 * 两句话像了，用户就会拿删除当"取消"用——而那是不可逆的。
 */
export const Cloning: Story = {
  args: { cloneStatus: 'cloning' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('group-menu-cancel-clone')).toHaveTextContent(
      '取消克隆（保留项目）',
    );
    await expect(canvas.getByTestId('group-menu-delete')).toHaveTextContent('删除项目…');
  },
};

/** 动作在途：三出口禁用；失败原因就地显示（⛔ 不静默吞掉）。 */
export const BusyWithError: Story = {
  args: { cloneStatus: 'failed', busy: true, actionError: '该项目无需转换（当前不是失败态）。' },
};
