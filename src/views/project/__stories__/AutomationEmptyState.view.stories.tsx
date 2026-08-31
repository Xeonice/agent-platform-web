// F21-7 §7.2：空态文案 + CTA。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { AutomationEmptyStateView } from '@/views/project/AutomationEmptyState.view';

const meta: Meta<typeof AutomationEmptyStateView> = {
  title: 'Project/AutomationEmptyState',
  component: AutomationEmptyStateView,
  parameters: { layout: 'padded' },
  args: { onCreate: fn() },
};
export default meta;

type Story = StoryObj<typeof AutomationEmptyStateView>;

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/为重复性工作创建一条自动化规则/)).toBeInTheDocument();
    await expect(canvas.getByTestId('automation-create')).toBeEnabled();
  },
};
