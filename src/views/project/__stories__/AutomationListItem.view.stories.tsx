// F21-7 §7.2：规则列表行的五格状态矩阵。
// play 钉住两条最容易被"顺手简化"掉的东西：① 时区永远在行上；② 🔴 与 ⏸️ 是两回事。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { AutomationListItemView } from '@/views/project/AutomationListItem.view';
import type { AutomationRow } from '@/types/automation';

const BASE: AutomationRow = {
  id: 'auto-1',
  name: '每天凌晨数据分析',
  lifecycle: 'on',
  icon: '✅',
  statusText: '已启用',
  summaryText: 'codex · 每天 08:00',
  nextTriggerText: '8-10 08:00',
  timezone: 'Asia/Shanghai',
  needsAttention: false,
  consecutiveFailures: 0,
};

const meta: Meta<typeof AutomationListItemView> = {
  title: 'Project/AutomationListItem',
  component: AutomationListItemView,
  parameters: { layout: 'padded' },
  args: { row: BASE, onSelect: fn(), onToggle: fn(), onShowFailure: fn() },
  decorators: [
    (Story) => (
      <ul className="max-w-md">
        <Story />
      </ul>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof AutomationListItemView>;

/** ✅ 启用：下次触发时间 + 时区。 */
export const Enabled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('automation-summary')).toHaveTextContent('下次: 8-10 08:00');
    // ⭐ 时区必须在这一行上：只给「8-10 08:00」，换台机器打开的人会以为触发时刻漂了。
    await expect(canvas.getByTestId('automation-timezone')).toHaveTextContent('Asia/Shanghai');
    await expect(canvas.getByTestId('automation-toggle')).toHaveTextContent('禁用');
    await expect(canvas.queryByTestId('automation-show-failure')).toBeNull();
  },
};

/** ✅ 启用，但规则时区与本机不同 → 多一句提醒。 */
export const ForeignTimeZone: Story = {
  args: {
    row: { ...BASE, timezoneNote: '按 Asia/Shanghai 的钟点触发（你现在是 America/New_York）' },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('automation-timezone')).toHaveTextContent(
      'America/New_York',
    );
  },
};

/** ⏸️ 手动禁用：无下次触发时间（它不会触发，给一个时刻是误导）。 */
export const ManuallyDisabled: Story = {
  args: {
    row: {
      ...BASE,
      lifecycle: 'off',
      icon: '⏸️',
      statusText: '已禁用（不会触发）',
      nextTriggerText: undefined,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('automation-toggle')).toHaveTextContent('启用');
    await expect(canvas.getByTestId('automation-summary')).not.toHaveTextContent('下次');
    // ⭐ 手动禁用**不给** [查看原因]：没有原因可查，摆一个只会让人以为出了事。
    await expect(canvas.queryByTestId('automation-show-failure')).toBeNull();
  },
};

/** 🟡 降频：连续失败 ≥3，改为每日重试一次。 */
export const Degraded: Story = {
  args: {
    row: {
      ...BASE,
      lifecycle: 'degraded',
      icon: '🟡',
      statusText: '已降频：每日重试一次（连续失败 3 次）',
      needsAttention: true,
      consecutiveFailures: 3,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('automation-status-text')).toHaveTextContent('每日重试一次');
    await expect(canvas.getByTestId('automation-show-failure')).toBeInTheDocument();
  },
};

/** 🔴 自动禁用：[重新启用] + 明示计数清零。 */
export const AutoDisabled: Story = {
  args: {
    row: {
      ...BASE,
      lifecycle: 'autoDisabled',
      icon: '🔴',
      statusText: '连续失败 10 次，已自动暂停',
      nextTriggerText: undefined,
      needsAttention: true,
      consecutiveFailures: 10,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⭐ 与「手动禁用」必须长得不一样：那个按钮说的是两件不同的事。
    await expect(canvas.getByTestId('automation-toggle')).toHaveTextContent('重新启用');
    await expect(canvas.getByTestId('automation-show-failure')).toBeInTheDocument();
    // 文案要明示清零，否则用户不知道这一下是不是"又三次就再关一遍"。
    await expect(canvas.getByText(/失败计数清零/)).toBeInTheDocument();
  },
};
