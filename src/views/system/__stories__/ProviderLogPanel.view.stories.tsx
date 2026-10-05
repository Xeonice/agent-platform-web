import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ProviderLogPanelView } from '@/views/system/ProviderLogPanel.view';

const meta: Meta<typeof ProviderLogPanelView> = {
  title: 'System/ProviderLogPanel',
  component: ProviderLogPanelView,
  args: {
    id: 'provider-log-aio',
    lines: ['2026-10-05 [AioSandboxProvider] 环境已就绪'],
    isLoading: false,
    isError: false,
  },
};
export default meta;
type Story = StoryObj<typeof ProviderLogPanelView>;
export const Recent: Story = {};
export const Loading: Story = { args: { isLoading: true, lines: [] } };
export const Unavailable: Story = {
  args: { lines: [], unavailableReason: '这个环境暂时没有运行日志。' },
};
export const Failed: Story = { args: { isError: true, lines: [] } };
