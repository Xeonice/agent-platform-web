import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AllowedHostsEditorView } from '@/views/settings/AllowedHostsEditor.view';

const noop = (): void => undefined;

const meta: Meta<typeof AllowedHostsEditorView> = {
  title: 'Settings/AllowedHostsEditor',
  component: AllowedHostsEditorView,
  parameters: { layout: 'centered' },
  args: { onChange: noop },
};
export default meta;

type Story = StoryObj<typeof AllowedHostsEditorView>;

export const Empty: Story = { args: { value: [] } };
export const MultipleHosts: Story = {
  args: { value: ['github.com', 'git.internal.example.com'] },
};
