import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { KeyRound, Package, Settings } from 'lucide-react';
import { expect, within } from 'storybook/test';
import { SettingsMenuView } from '@/views/settings/SettingsMenu.view';

const noop = (): void => undefined;

const meta: Meta<typeof SettingsMenuView> = {
  title: 'Settings/SettingsMenu',
  component: SettingsMenuView,
  parameters: { layout: 'fullscreen' },
  args: {
    items: [
      { key: 'credentials', label: '凭证管理', icon: KeyRound },
      { key: 'images', label: '镜像管理', icon: Package, disabled: true },
      { key: 'system', label: '系统状态', icon: Settings, disabled: true },
    ],
    onSelect: noop,
    onBackToWorkbench: noop,
  },
};
export default meta;

type Story = StoryObj<typeof SettingsMenuView>;

export const CredentialsActive: Story = {
  args: { activeKey: 'credentials' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⭐ emoji 收口回归：`label` 曾经是 `'🔐 凭证管理'`，可访问名（按钮文本）跟着带 emoji。
    // 拆出 `icon` 字段后，可访问名必须精确是「凭证管理」——不多带 emoji、不多带空白、也不是空。
    // MUTATION：把 `label` 改回 `'🔐 凭证管理'`（或把图标塞回文案）⇒ 这条 exact-name 查询找不到
    // 按钮，直接抛错；只断言 `toHaveTextContent(/凭证管理/)` 之类的模糊匹配锁不住这一点。
    const credentialsBtn = canvas.getByRole('button', { name: '凭证管理' });
    await expect(credentialsBtn).toBeInTheDocument();
    // 图标确实换成了 lucide 组件（不是残留的 emoji 字符，也不是随手换了另一个图标）：
    // lucide 组件会给 svg 打上 `lucide-<kebab-name>` class，精确锁定"用的是哪一个"图标。
    // MUTATION：把 `icon: KeyRound` 换成任意别的 lucide 图标 ⇒ 这条 class 断言先红。
    await expect(credentialsBtn.querySelector('svg.lucide-key-round')).not.toBeNull();
    // 按钮文本里不应该再出现任何 emoji 字符（双保险：即使换了别的钥匙态 emoji 也能抓到）。
    await expect(credentialsBtn.textContent).toBe('凭证管理');

    const imagesBtn = canvas.getByRole('button', { name: '镜像管理' });
    await expect(imagesBtn.querySelector('svg.lucide-package')).not.toBeNull();
    await expect(imagesBtn.textContent).toBe('镜像管理');

    const systemBtn = canvas.getByRole('button', { name: '系统状态' });
    await expect(systemBtn.querySelector('svg.lucide-settings')).not.toBeNull();
    await expect(systemBtn.textContent).toBe('系统状态');
  },
};

/**
 * ⭐ 390px 响应式回归：写死的 `w-56`（224px）此前不响应式收起，把内容区挤到约 118px
 * （design/design-notes.md 收口第 3 项）。⇒ 窄屏下改成 `w-full` + 顶部横向可滚动条，
 * `sm:` 起才切回固定 `sm:w-56` 的竖排侧边栏。
 */
export const Responsive: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = canvas.getByRole('navigation', { name: '设置菜单' });
    // MUTATION：把 `sm:w-56` 从 `SettingsMenuView` 的 className 里删掉 ⇒ 这两条其中一条
    // 会红（窄屏仍是 `w-full` 没问题，但桌面态再也拿不到固定宽度，看着像没收口）。
    await expect(nav).toHaveClass('w-full');
    await expect(nav).toHaveClass('sm:w-56');
    // 窄屏是横向排列 + 可横向滚动（不是纵向挤压），`sm:` 起切回竖排。
    await expect(nav).toHaveClass('flex-row');
    await expect(nav).toHaveClass('sm:flex-col');
    await expect(nav).toHaveClass('overflow-x-auto');
  },
};
