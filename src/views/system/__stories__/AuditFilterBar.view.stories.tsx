import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AuditFilterBarView } from '@/views/system/AuditFilterBar.view';

const meta: Meta<typeof AuditFilterBarView> = {
  title: 'System/AuditFilterBar',
  component: AuditFilterBarView,
  parameters: { layout: 'padded' },
  args: {
    alertsOnly: false,
    fromLocal: '',
    toLocal: '',
    onCategoryChange: fn(),
    onAlertsOnlyChange: fn(),
    onFromChange: fn(),
    onToChange: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof AuditFilterBarView>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 五个类别 + 「全部」（沙箱/项目/凭证/镜像/系统，P21-5 §10.2）。
    await expect(canvas.getAllByRole('option')).toHaveLength(6);
  },
};

export const AlertsOnly: Story = {
  args: { alertsOnly: true, category: 'sandbox' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText('仅告警')).toBeChecked();
    await userEvent.click(canvas.getByLabelText('仅告警'));
    // 产品只给**一个开关**，不是三选一：回调收到的就是布尔。
    await expect(args.onAlertsOnlyChange).toHaveBeenCalledWith(false);
  },
};

export const WithTimeRange: Story = {
  args: { fromLocal: '2026-08-26T00:00', toLocal: '2026-08-26T23:59' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 时间范围是**筛选**，不是翻页（§3A ⑤）：这里只有两个输入框，没有任何"跳到那一页"。
    await expect(canvas.getByLabelText('起始时间')).toHaveValue('2026-08-26T00:00');
    await expect(canvas.getByLabelText('结束时间')).toHaveValue('2026-08-26T23:59');
  },
};
