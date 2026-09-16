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
    /*
     * ⭐ **未配置的行上没有任何状态标记**（2026-09-16 裁决，原本挂着一个 `skipped` pill）。
     *
     * 三条理由（`AuthMethodRadioRow.view.tsx` 里有完整版）：按钮文案已经分得开
     * （未配置「登录帐号 / 添加 API Key」vs 已配置「重新登录 / 更换」）；卡头已经说过
     * 一次；而 `skipped` 是 warning 橙 —— 「二选一没选的那一路」是产品明说的正常状态，
     * 给它橙色等于误报。⚠️ 橙色要留给真的用不了的那一个（整张卡未配置）。
     *
     * ⛔ 这是**否定断言**，且必须连"任何 `data-status` 都不在场"一起锁：
     * 只断言那个 testid 不存在的话，换个 testid 把 pill 加回来照样绿。
     */
    await expect(canvas.queryByTestId('auth-unconfigured-badge')).toBeNull();
    await expect(canvas.queryByText('未配置')).toBeNull();
    await expect(canvasElement.querySelector('[data-status]')).toBeNull();
    // 而"这里还没有"这件事由按钮说：⛔ 不是「更换」，是「添加 API Key」。
    await expect(canvas.getByRole('button', { name: /添加 API Key|登录帐号/ })).toBeInTheDocument();
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
