// F21-7 §7.2：规则列表行的五格状态矩阵。
// play 钉住两条最容易被"顺手简化"掉的东西：① 时区永远在行上；② 自动禁用（fail）与手动禁用（off）是两回事。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { AutomationListItemView } from '@/views/project/AutomationListItem.view';
import type { AutomationRow } from '@/types/automation';

const BASE: AutomationRow = {
  id: 'auto-1',
  name: '每天凌晨数据分析',
  lifecycle: 'on',
  status: 'ok',
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

/** 启用（`status: 'ok'`）：下次触发时间 + 时区 + Check 图标。 */
export const Enabled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('automation-summary')).toHaveTextContent('下次: 8-10 08:00');
    // ⭐ 时区必须在这一行上：只给「8-10 08:00」，换台机器打开的人会以为触发时刻漂了。
    await expect(canvas.getByTestId('automation-timezone')).toHaveTextContent('Asia/Shanghai');
    await expect(canvas.getByTestId('automation-toggle')).toHaveTextContent('关掉');
    await expect(canvas.queryByTestId('automation-show-failure')).toBeNull();
    // MUTATION：把 `LifecycleIcon` 换回 emoji 字符或换成另一个图标 ⇒ 这两条先红——
    // 只断言"图标存在"锁不住"是哪一个"，`svg.lucide-check` 才是真正锁得住的那一半。
    const icon = canvas.getByTestId('automation-lifecycle-icon');
    await expect(icon).toHaveAttribute('data-lifecycle-status', 'ok');
    await expect(icon.tagName.toLowerCase()).toBe('svg');
    await expect(icon.classList.contains('lucide-check')).toBe(true);
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

/** 手动禁用（`status` 缺席——八态里没有对应，中性 `Pause` 图标）：无下次触发时间。 */
export const ManuallyDisabled: Story = {
  args: {
    row: {
      ...BASE,
      lifecycle: 'off',
      status: undefined,
      statusText: '已禁用（不会触发）',
      nextTriggerText: undefined,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('automation-toggle')).toHaveTextContent('开启');
    await expect(canvas.getByTestId('automation-summary')).not.toHaveTextContent('下次');
    // ⭐ 手动禁用**不给** [查看原因]：没有原因可查，摆一个只会让人以为出了事。
    await expect(canvas.queryByTestId('automation-show-failure')).toBeNull();
    // MUTATION：把 `status===undefined` 分支误判成 warn/fail 之一 ⇒ 这两条先红——
    // `off` 在八态里没有精确对应，见交付报告"待拍板点"。
    const icon = canvas.getByTestId('automation-lifecycle-icon');
    await expect(icon).toHaveAttribute('data-lifecycle-status', 'off');
    await expect(icon.classList.contains('lucide-pause')).toBe(true);
  },
};

/** 放慢（`status: 'warn'`）：连着失败 ≥3，改为每天只试一次。 */
export const Degraded: Story = {
  args: {
    row: {
      ...BASE,
      lifecycle: 'degraded',
      status: 'warn',
      statusText: '连着失败 3 次，已经放慢：现在每天只试一次',
      needsAttention: true,
      consecutiveFailures: 3,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('automation-status-text')).toHaveTextContent('每天只试一次');
    await expect(canvas.getByTestId('automation-show-failure')).toBeInTheDocument();
    // ⚠️ `AlertTriangle` 是 lucide 历史别名，渲染出的 class 是 `lucide-triangle-alert`
    // （不是 `lucide-alert-triangle`）——写错这个名字断言会一直找不到元素而不是失败于内容。
    const icon = canvas.getByTestId('automation-lifecycle-icon');
    await expect(icon).toHaveAttribute('data-lifecycle-status', 'warn');
    await expect(icon.classList.contains('lucide-triangle-alert')).toBe(true);
  },
};

/** 自动禁用（`status: 'fail'`）：[重新启用] + 明示计数清零。 */
export const AutoDisabled: Story = {
  args: {
    row: {
      ...BASE,
      lifecycle: 'autoDisabled',
      status: 'fail',
      statusText: '连着失败 10 次（放慢后又失败 7 次），已自动停用',
      nextTriggerText: undefined,
      needsAttention: true,
      consecutiveFailures: 10,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⭐ 与「手动禁用」必须长得不一样：那个按钮说的是两件不同的事。
    await expect(canvas.getByTestId('automation-toggle')).toHaveTextContent('重新开启');
    await expect(canvas.getByTestId('automation-show-failure')).toBeInTheDocument();
    // 文案要明示清零，否则用户不知道这一下是不是"又三次就再关一遍"。
    await expect(canvas.getByText(/失败次数清零/)).toBeInTheDocument();
    const icon = canvas.getByTestId('automation-lifecycle-icon');
    await expect(icon).toHaveAttribute('data-lifecycle-status', 'fail');
    await expect(icon.classList.contains('lucide-x')).toBe(true);
    // ⭐ 与「手动禁用」的图标必须不同（一个中性、一个红色 X）——判定顺序写反的回归。
    await expect(icon.classList.contains('lucide-pause')).toBe(false);
  },
};
