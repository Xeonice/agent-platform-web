import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { AuthMethodRadioRowView } from '@/views/settings/AuthMethodRadioRow.view';
import type { AuthModeRow } from '@/types/runtimeCredential';

const noop = (): void => undefined;

const activeAccount: AuthModeRow = {
  mode: 'account',
  method: 'oauth-device',
  label: '帐号授权',
  configured: true,
  active: true,
  maskedIdentifier: 'a***@gmail.com',
  expiryLabel: '剩 30 天',
  expiryState: 'ok',
};

const meta: Meta<typeof AuthMethodRadioRowView> = {
  title: 'Settings/AuthMethodRadioRow',
  component: AuthMethodRadioRowView,
  parameters: { layout: 'centered' },
  args: {
    row: activeAccount,
    onSwitch: noop,
    onNeedSetup: noop,
    onReauth: noop,
    onAddKey: noop,
    onRevoke: noop,
  },
};
export default meta;

type Story = StoryObj<typeof AuthMethodRadioRowView>;

/** 生效中 + [生效中] 徽标。 */
export const ActiveAccount: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⭐「当前使用」走 StatusPill(ok)——断言到 data-status，不能只断言"有徽标"，
    // 换成别的态（如误配成 info/pending）这条要先红。
    await expect(canvas.getByTestId('auth-active-badge')).toHaveAttribute('data-status', 'ok');
  },
};

/** 已配置未生效（○，点击 → onSwitch）。 */
export const ConfiguredInactive: Story = {
  args: { row: { ...activeAccount, active: false } },
};

/** 未选中未配置（显「未配置」，点击 → onNeedSetup）。 */
export const NotConfigured: Story = {
  args: {
    row: {
      mode: 'api-key',
      method: 'api-key',
      label: 'API Key',
      configured: false,
      active: false,
      expiryState: 'noExpiry',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⭐ 「未配置」= skipped（虚线框），⛔ 不是 fail：它不是错误，是"这一路没走"。
    // 只断言"有个 pill"锁不住这条——换成 fail 这条会先红。
    await expect(canvas.getByTestId('auth-unconfigured-badge')).toHaveAttribute(
      'data-status',
      'skipped',
    );
  },
};

/** <7 天预警。 */
export const Expiring: Story = {
  args: { row: { ...activeAccount, expiryLabel: '剩 6 天', expiryState: 'warning' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const marker = canvas.getByTestId('auth-expiry-marker');
    await expect(marker).toHaveTextContent('剩 6 天');
    // MUTATION：把 `AlertTriangle` 换回 ⚠️ 字符或换成另一个图标 ⇒ 这条先红——只锁
    // 文案（上面那条）在两种写法下都绿，锁不住"真的换成了哪个图标"。
    await expect(marker.querySelector('svg.lucide-triangle-alert')).not.toBeNull();
    // ⚠️ 这一态刻意不是 StatusPill——它显示的是动态倒计时（"剩 N 天"），不是
    // "即将过期"这句固定状态文案（原型 #credentials 里同一格也是纯色文字不是 pill）。
    // 断言到没有 data-status，锁住"别把它也顺手换成 pill"这条决策。
    await expect(marker.hasAttribute('data-status')).toBe(false);
  },
};

/** 已过期。 */
export const Expired: Story = {
  args: { row: { ...activeAccount, expiryLabel: '已过期', expiryState: 'expired' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const marker = canvas.getByTestId('auth-expiry-marker');
    await expect(marker).toHaveTextContent('已过期');
    await expect(marker.querySelector('svg.lucide-x')).not.toBeNull();
    // ⭐ 断言到 data-status="fail"：只锁图标锁不住"真的用的是 StatusPill 的 fail 态"
    // ——万一以后 fail 的图标改了，图标断言会失真，这条不会。
    await expect(marker).toHaveAttribute('data-status', 'fail');
  },
};
