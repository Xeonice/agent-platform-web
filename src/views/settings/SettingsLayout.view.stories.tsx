import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SettingsLayoutView } from '@/views/settings/SettingsLayout.view';
import { SettingsMenuView } from '@/views/settings/SettingsMenu.view';

const noop = (): void => undefined;

const meta: Meta<typeof SettingsLayoutView> = {
  title: 'Settings/SettingsLayout',
  component: SettingsLayoutView,
  parameters: { layout: 'fullscreen' },
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
