import type { Meta, StoryObj } from '@storybook/nextjs-vite';
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
          { key: 'credentials', label: '🔐 凭证管理' },
          { key: 'images', label: '🖼️ 镜像管理', disabled: true },
        ]}
        activeKey="credentials"
        onSelect={noop}
        onBackToWorkbench={noop}
      />
    ),
    children: <p className="text-sm text-muted-foreground">内容区（子页 children）</p>,
  },
};
