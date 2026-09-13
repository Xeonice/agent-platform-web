import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { RevokeConfirmDialogView } from '@/views/settings/RevokeConfirmDialog.view';

// P0-4 文案（与 lib/runtimeCredential 的两条常量同源；story 不可 import lib，故就地内联）。
const RUNTIME_REVOKE_WARNING =
  '删除会重启正在用这份凭证跑的任务；已经被带出沙箱的 token，平台这边删不掉。';
const RUNTIME_REVOKE_FOLLOW_UP =
  '担心已经外流的话，去签发这串凭证的厂商后台把它作废，那边才是唯一能真正吊销它的地方。';

const noop = (): void => undefined;

function tasks(n: number): { id: string; name: string }[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t-${String(i)}`,
    name: `任务 ${String(i + 1)}`,
  }));
}

const meta: Meta<typeof RevokeConfirmDialogView> = {
  title: 'Settings/RevokeConfirmDialog',
  component: RevokeConfirmDialogView,
  args: {
    runtimeName: 'Codex',
    modeLabel: '帐号登录',
    affectedItems: [],
    restCount: 0,
    affectedKnown: true,
    warningText: RUNTIME_REVOKE_WARNING,
    followUpText: RUNTIME_REVOKE_FOLLOW_UP,
    onConfirm: noop,
    onCancel: noop,
  },
};
export default meta;

type Story = StoryObj<typeof RevokeConfirmDialogView>;

/** 确实查过了、确实没有任务在跑。 */
export const NoAffected: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/现在没有任务在用这份凭证/)).toBeVisible();
    // P0-4 的断言必现，且**必须带着能做的那件事**一起出现。
    await expect(canvas.getByText(/平台这边删不掉/)).toBeVisible();
    await expect(canvas.getByText(/厂商后台/)).toBeVisible();
  },
};

/**
 * ⛔ **清单查不到**：绝不能渲染成「没有任务在跑」。
 * 这一条钉的正是那个 bug —— 上游恒传空数组时，用户看到的是一句确定的「没有」，
 * 然后按下删除，正在跑的 10 个任务全被重启。
 */
export const AffectedUnknown: Story = {
  args: { affectedKnown: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('affected-unknown')).toBeVisible();
    await expect(canvas.queryByText(/现在没有任务在用这份凭证/)).toBeNull();
  },
};

/** 3 条受影响 Task。 */
export const ThreeAffected: Story = { args: { affectedItems: tasks(3) } };

/** 12 条（10 +「等共 12 个」）。 */
export const TwelveAffected: Story = { args: { affectedItems: tasks(10), restCount: 2 } };

/** 删掉的正是当前在用的那份（额外警示）。 */
export const RevokeActiveMode: Story = { args: { affectedItems: tasks(2), warnActiveMode: true } };
