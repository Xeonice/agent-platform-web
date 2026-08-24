import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { RevokeConfirmDialogView } from '@/views/settings/RevokeConfirmDialog.view';

// P0-4 文案（与 lib/runtimeCredential.RUNTIME_REVOKE_WARNING 同源；story 不可 import lib，故就地内联）。
const RUNTIME_REVOKE_WARNING =
  '吊销会重启正在使用该凭证的运行实例；已泄漏到沙箱外的 token 无法追回。';

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
    modeLabel: '帐号授权',
    affectedItems: [],
    restCount: 0,
    warningText: RUNTIME_REVOKE_WARNING,
    onConfirm: noop,
    onCancel: noop,
  },
};
export default meta;

type Story = StoryObj<typeof RevokeConfirmDialogView>;

/** 无受影响 Task。 */
export const NoAffected: Story = {};

/** 3 条受影响 Task。 */
export const ThreeAffected: Story = { args: { affectedItems: tasks(3) } };

/** 12 条（10 +「等共 12 个」）。 */
export const TwelveAffected: Story = { args: { affectedItems: tasks(10), restCount: 2 } };

/** 吊销生效中模式（额外警示）。 */
export const RevokeActiveMode: Story = { args: { affectedItems: tasks(2), warnActiveMode: true } };
