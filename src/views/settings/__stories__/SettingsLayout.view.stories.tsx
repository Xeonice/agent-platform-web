import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { KeyRound, Package } from 'lucide-react';
import { expect, within } from 'storybook/test';
import { SettingsLayoutView } from '@/views/settings/SettingsLayout.view';
import { SettingsMenuView } from '@/views/settings/SettingsMenu.view';

const noop = (): void => undefined;

const meta: Meta<typeof SettingsLayoutView> = {
  title: 'Settings/SettingsLayout',
  component: SettingsLayoutView,
  parameters: { layout: 'fullscreen' },
  /**
   * ⚠️ 这个 `h-screen` 外壳是**替 `app/layout.tsx` 站的位**：壳本身用 `h-full`，高度由根布局
   * 那个 flex 列（横幅 + `min-h-0 flex-1`）给。story 里没有那一层，不套的话整块塌成 0 高。
   */
  decorators: [(Story) => <div className="h-screen">{Story()}</div>],
};
export default meta;

type Story = StoryObj<typeof SettingsLayoutView>;

export const WithMenu: Story = {
  args: {
    menu: (
      <SettingsMenuView
        items={[
          { key: 'credentials', label: '凭证管理', icon: KeyRound },
          { key: 'images', label: '镜像管理', icon: Package, disabled: true },
        ]}
        activeKey="credentials"
        onSelect={noop}
        onBackToWorkbench={noop}
      />
    ),
    children: <p className="text-sm text-muted-foreground">内容区（子页 children）</p>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = canvas.getByRole('navigation', { name: '设置菜单' });
    const root = nav.parentElement;
    // ⭐ 390px 响应式回归：壳体在窄屏下**竖着堆**（菜单条在上、内容区在下），`sm:` 起
    // 才变回左右并排——`flex-row` 单独一套在 390px 下会把内容区挤到不到 120px
    // （design/design-notes.md 收口第 3 项）。
    // MUTATION：把 `SettingsLayoutView` 根节点的 `flex-col sm:flex-row` 改回
    // 纯 `flex`（相当于恒 `flex-row`）⇒ 下面两条其中一条会红。
    await expect(root).toHaveClass('flex-col');
    await expect(root).toHaveClass('sm:flex-row');
  },
};

/**
 * 内容区宽度两档。
 *
 * ⚠️ **两条断言缺一不可，它们钉的是相反方向**：
 *   · `wide` 必须去掉 `max-w-3xl` —— 系统状态是两栏卡片栅格，压在 768px 里每列只剩
 *     ~340px，pill 文字会被截断（实测「未得出结论」显示成「联网检...」）；
 *   · `form` 必须保留 `max-w-3xl` —— 凭证/镜像是表单，一行输入框横跨满屏会让 label
 *     与 input 离得太远。
 * ⛔ 只写一条的话，「把两档统一成同一个值」这种改法会有一半悄悄溜过去。
 */
export const WideWidthForDashboards: Story = {
  args: { ...WithMenu.args, width: 'wide' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByText('内容区（子页 children）').parentElement;
    await expect(box).toHaveAttribute('data-width', 'wide');
    await expect(box).toHaveClass('max-w-none');
    await expect(box).not.toHaveClass('max-w-3xl');
  },
};

export const FormWidthIsDefault: Story = {
  args: WithMenu.args,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByText('内容区（子页 children）').parentElement;
    // 缺省即 `form`：⛔ 不传 `width` 的调用方不该被悄悄改成满宽。
    await expect(box).toHaveAttribute('data-width', 'form');
    await expect(box).toHaveClass('max-w-3xl');
    await expect(box).not.toHaveClass('max-w-none');
  },
};
