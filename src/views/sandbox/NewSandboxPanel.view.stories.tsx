import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NewSandboxPanelView } from '@/views/sandbox/NewSandboxPanel.view';
import { SANDBOX_PROVIDERS } from '@/types/sandbox';

const noop = (): void => undefined;

const meta: Meta<typeof NewSandboxPanelView> = {
  title: 'Sandbox/NewSandboxPanel',
  component: NewSandboxPanelView,
  parameters: { layout: 'fullscreen' },
  args: {
    providers: SANDBOX_PROVIDERS,
    onSelectProvider: noop,
    onCreate: noop,
  },
};
export default meta;

type Story = StoryObj<typeof NewSandboxPanelView>;

export const DefaultAio: Story = { args: { provider: 'aio', creating: false } };
export const BoxliteSelected: Story = { args: { provider: 'boxlite', creating: false } };
export const Creating: Story = { args: { provider: 'aio', creating: true } };
export const CreateError: Story = {
  args: { provider: 'aio', creating: false, errorMessage: '创建失败：镜像拉取超时' },
};
