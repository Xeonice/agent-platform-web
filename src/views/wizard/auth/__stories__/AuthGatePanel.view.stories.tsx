import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AuthGatePanelView } from '@/views/wizard/auth/AuthGatePanel.view';

const noop = (): void => undefined;

const meta: Meta<typeof AuthGatePanelView> = {
  title: 'Wizard/AuthGatePanel',
  component: AuthGatePanelView,
  parameters: { layout: 'centered' },
  args: {
    runtimeName: 'Codex',
    tabs: [
      { key: 'account', label: '帐号授权' },
      { key: 'api-key', label: 'API Key' },
    ],
    selectedTab: 'account',
    onSelectTab: noop,
    children: <p className="text-xs text-muted-foreground">（子面板占位）</p>,
  },
};
export default meta;

type Story = StoryObj<typeof AuthGatePanelView>;

export const AccountTab: Story = {};

export const ApiKeyTab: Story = { args: { selectedTab: 'api-key' } };

export const InterceptWithNotice: Story = {
  args: { showOneTimeNotice: true, onOpenCredentials: noop },
};
