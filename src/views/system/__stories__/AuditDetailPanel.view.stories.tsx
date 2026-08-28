import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { AuditDetailPanelView } from '@/views/system/AuditDetailPanel.view';

const meta: Meta<typeof AuditDetailPanelView> = {
  title: 'System/AuditDetailPanel',
  component: AuditDetailPanelView,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof AuditDetailPanelView>;

export const Formatted: Story = {
  args: {
    detailText: JSON.stringify({ provider: 'aio', attempt: 2, stage: 'workspace' }, null, 2),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 收到的就是一个**已经格式化好的串**：view 不做 JSON.stringify（它碰不到 lib）。
    await expect(canvas.getByTestId('audit-detail-panel')).toHaveTextContent('"provider": "aio"');
  },
};

export const LongPayloadScrolls: Story = {
  args: {
    detailText: JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => [`key${String(i)}`, `value-${String(i)}`]),
      ),
      null,
      2,
    ),
  },
};
