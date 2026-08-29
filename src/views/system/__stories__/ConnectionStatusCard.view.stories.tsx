import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ConnectionStatusCardView } from '@/views/system/ConnectionStatusCard.view';
import type { ConnectionStatusCardModel } from '@/types/system';

const HEALTHY: ConnectionStatusCardModel = {
  rows: [
    { id: 'rest', label: 'REST', state: 'ok', valueText: '正常（本页数据刚取回）' },
    { id: 'events', label: 'WS /events', state: 'ok', valueText: '延迟 15ms' },
    { id: 'terminals', label: '终端连接', state: 'ok', valueText: '2 个终端会话（2 个已连接）' },
  ],
};

const meta: Meta<typeof ConnectionStatusCardView> = {
  title: 'System/ConnectionStatusCard',
  component: ConnectionStatusCardView,
  parameters: { layout: 'padded' },
  args: { model: HEALTHY },
};
export default meta;

type Story = StoryObj<typeof ConnectionStatusCardView>;

export const AllGreen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('connection-row-events')).toHaveTextContent('15ms');
  },
};

/** ⭐ 「测不了」是 ⚪ 不是 🔴 —— 这条通道只挂在工作台，本页没有它。 */
export const EventsUnmeasured: Story = {
  args: {
    model: {
      rows: [
        HEALTHY.rows[0] ?? { id: 'rest', label: 'REST', state: 'ok', valueText: '正常' },
        {
          id: 'events',
          label: 'WS /events',
          state: 'unknown',
          valueText: '本页未测量',
          hint: '/events 只在工作台挂载（本页不另开一条连接）',
        },
        { id: 'terminals', label: '终端连接', state: 'ok', valueText: '0 个终端会话' },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('connection-row-events');
    await expect(row).toHaveTextContent('未知');
    // ⚠️ 否定断言：渲染成「异常」就是每次进设置页都亮一次的假警报。
    await expect(row).not.toHaveTextContent('异常');
    // 「测不了」必须带上为什么。
    await expect(row).toHaveTextContent('只在工作台挂载');
  },
};

/** REST 真的挂了 —— 这一条是**测到的**，与上面那条性质完全不同。 */
export const RestDown: Story = {
  args: {
    model: {
      rows: [
        {
          id: 'rest',
          label: 'REST',
          state: 'down',
          valueText: '请求失败',
          hint: '错误码 INTERNAL',
        },
        HEALTHY.rows[1] ?? {
          id: 'events',
          label: 'WS /events',
          state: 'ok',
          valueText: '延迟 15ms',
        },
        HEALTHY.rows[2] ?? {
          id: 'terminals',
          label: '终端连接',
          state: 'ok',
          valueText: '0 个终端会话',
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('connection-row-rest');
    await expect(row).toHaveTextContent('异常');
    await expect(row).toHaveTextContent('INTERNAL');
  },
};

export const NoTerminals: Story = {
  args: {
    model: {
      rows: [
        HEALTHY.rows[0] ?? { id: 'rest', label: 'REST', state: 'ok', valueText: '正常' },
        HEALTHY.rows[1] ?? {
          id: 'events',
          label: 'WS /events',
          state: 'ok',
          valueText: '延迟 15ms',
        },
        { id: 'terminals', label: '终端连接', state: 'ok', valueText: '0 个终端会话' },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 0 是事实不是未知：这一行仍是 ✅「正常」。
    await expect(canvas.getByTestId('connection-row-terminals')).toHaveTextContent('0 个终端会话');
  },
};
