import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SettingsMenuView } from '@/views/settings/SettingsMenu.view';

const noop = (): void => undefined;

const meta: Meta<typeof SettingsMenuView> = {
  title: 'Settings/SettingsMenu',
  component: SettingsMenuView,
  parameters: { layout: 'fullscreen' },
  args: {
    items: [
      { key: 'credentials', label: '🔐 凭证管理' },
      { key: 'images', label: '🖼️ 镜像管理', disabled: true },
      { key: 'system', label: '⚙️ 系统状态', disabled: true },
    ],
    onSelect: noop,
    onBackToWorkbench: noop,
  },
};
export default meta;

type Story = StoryObj<typeof SettingsMenuView>;

export const CredentialsActive: Story = { args: { activeKey: 'credentials' } };
