import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { StatusDot, StatusPill } from '@/components/ui/status-pill';

const meta: Meta<typeof StatusPill> = {
  title: 'UI/StatusPill',
  component: StatusPill,
  parameters: { layout: 'padded' },
};
export default meta;

type Story = StoryObj<typeof StatusPill>;

// 八个 variant 各一个 story（Phase 0 硬要求）：每个都断言 data-status 落在正确的态上，
// 且图标确实渲染了（三重线索里的"图标"这一环，不是只靠颜色/文字）。

export const Ok: Story = {
  args: { status: 'ok', children: '正常' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pill = canvas.getByText('正常');
    await expect(pill).toHaveAttribute('data-status', 'ok');
    await expect(pill.querySelector('svg')).not.toBeNull();
  },
};

export const Info: Story = {
  args: { status: 'info', children: '提示' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pill = canvas.getByText('提示');
    await expect(pill).toHaveAttribute('data-status', 'info');
    await expect(pill.querySelector('svg')).not.toBeNull();
  },
};

export const Warn: Story = {
  args: { status: 'warn', children: '警告' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pill = canvas.getByText('警告');
    await expect(pill).toHaveAttribute('data-status', 'warn');
    await expect(pill.querySelector('svg')).not.toBeNull();
  },
};

export const Fail: Story = {
  args: { status: 'fail', children: '不可达/失败' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pill = canvas.getByText('不可达/失败');
    await expect(pill).toHaveAttribute('data-status', 'fail');
    await expect(pill.querySelector('svg')).not.toBeNull();
  },
};

/** timeout 与 fail 独立色相：不能共用 --error（§1 问题 2「超时 ≠ 不可达」）。 */
export const Timeout: Story = {
  args: { status: 'timeout', children: '超时未响应' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pill = canvas.getByText('超时未响应');
    await expect(pill).toHaveAttribute('data-status', 'timeout');
    await expect(pill.className).not.toContain('text-error');
  },
};

/** pending：图标应带旋转动画（`animate-spin`），且不抢注意力（灰底无边框强调）。 */
export const Pending: Story = {
  args: { status: 'pending', children: '检查中…' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pill = canvas.getByText('检查中…');
    await expect(pill).toHaveAttribute('data-status', 'pending');
    const icon = pill.querySelector('svg');
    await expect(icon).not.toBeNull();
    await expect(icon?.getAttribute('class')).toContain('animate-spin');
  },
};

/** skipped：透明底 + 虚线边框，与 warn 的实心填充区分（同色不同笔触）。 */
export const Skipped: Story = {
  args: { status: 'skipped', children: '走过未达成' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pill = canvas.getByText('走过未达成');
    await expect(pill).toHaveAttribute('data-status', 'skipped');
    await expect(pill.className).toContain('border-dashed');
  },
};

/** unknown：虚线边框但颜色是灰（foreground-subtle），与 skipped 的琥珀区分。 */
export const Unknown: Story = {
  args: { status: 'unknown', children: '无样本/未知' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const pill = canvas.getByText('无样本/未知');
    await expect(pill).toHaveAttribute('data-status', 'unknown');
    await expect(pill.className).toContain('border-dashed');
    await expect(pill.className).toContain('text-foreground-subtle');
  },
};

// ————————————————————————————————————————————————————————————————
// StatusDot —— 极简变体（design-notes.md §4 Phase 3 第 2 条）：纯色圆点，
// 用在任务树状态点 / 组头徽标这类高密度位置。⚠️ 这是**新增**的独立小组件，
// 上面八个 `StatusPill` variant 的颜色/图标/语义一个字节都没有改动。
// ————————————————————————————————————————————————————————————————
type DotStory = StoryObj<typeof StatusDot>;

/** 六态一次性摆开，肉眼核对色相互不冲突（尤其 timeout 与 fail、unknown 与 warn/skipped 的琥珀/灰对比）。 */
export const Dots: DotStory = {
  render: () => (
    <div className="flex items-center gap-4">
      {(['ok', 'warn', 'fail', 'timeout', 'info', 'unknown'] as const).map((status) => (
        <span key={status} className="flex items-center gap-1.5 text-xs">
          <StatusDot status={status} label={status} />
          {status}
        </span>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const ok = canvas.getByLabelText('ok');
    await expect(ok).toHaveAttribute('data-status', 'ok');
    await expect(ok.className).toContain('bg-success');
    // 纯 dot：没有文字子节点、没有 svg 图标——与 `StatusPill` 的区别就在这里。
    await expect(ok.textContent).toBe('');
    await expect(ok.querySelector('svg')).toBeNull();
  },
};

/** 任务树里最常见的两态：等待输入（warn）与运行正常（ok）。 */
export const TaskTreeUsage: DotStory = {
  render: () => (
    <ul className="flex flex-col gap-1 text-sm">
      <li className="flex items-center gap-1.5">
        <StatusDot status="warn" label="等待你输入" />
        等待你输入的任务
      </li>
      <li className="flex items-center gap-1.5">
        <StatusDot status="ok" label="运行中" />
        运行中的任务
      </li>
    </ul>
  ),
};
