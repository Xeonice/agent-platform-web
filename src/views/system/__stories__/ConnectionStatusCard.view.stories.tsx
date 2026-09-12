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
    const row = canvas.getByTestId('connection-row-events');
    await expect(row).toHaveTextContent('15ms');
    // ⭐ Phase 1：`ok` 状态换成 `StatusPill`（design-notes §4）——钉住底层 variant 是
    //    `ok`，不是只钉文字（文字「正常」与 pill variant 是两件独立的事，只测文字
    //    抓不住"映射表被改错但文案凑巧还对"这种改法，见 `RestDown` 故事的反例）。
    await expect(row.querySelector('[data-status]')).toHaveAttribute('data-status', 'ok');
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
    // ⭐ Phase 1：`unknown` 映射到 `StatusPill` 的 `unknown`（虚线灰），不是 `fail`。
    await expect(row.querySelector('[data-status]')).toHaveAttribute('data-status', 'unknown');
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
    // ⭐ Phase 1：`down` 映射到 `StatusPill` 的 `fail`（红），这才是「确定坏了」的
    //    颜色/图标语义——只断言中文「异常」这四个字抓不住这一条，见文件头注释。
    // MUTATION：把 `STATE_PILL_STATUS.down` 从 `'fail'` 改成 `'ok'`，文字断言照样
    // 全绿（`STATE_TEXT` 没变），只有这一条会红。
    await expect(row.querySelector('[data-status]')).toHaveAttribute('data-status', 'fail');
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
