// F21-7 §7.2：运行历史八态（8 个 status 一个不少）。
// ★ play 钉住这一页的核心：**「跳过 / 错过 / 排队 / 真失败」是四件不同的事**，
//   判据是 `data-counts-toward-failure`，不是配色。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { RunHistoryItemView } from '@/views/project/RunHistoryItem.view';
import type { RunOutcome, RunRow } from '@/types/automation';

// ⚠️ **替身里的 outcome 是手写字面量，不是 `formatRunOutcome()` 的返回值。** 两个原因：
//  ① story 位于 `src/views/**`，boundaries 把它归为 `view` 元素 ⇒ 禁止 import `lib/`；
//  ② 更重要的是：从被测实现里派生期望值，等于用实现证明实现。手写一份独立的期望，
//     文案改错时 story 才会红（lib 那边另有一套 `formatRunOutcome.test.ts` 钉字符串）。
const OUTCOMES = {
  success: {
    category: 'success',
    icon: '✅',
    label: '成功',
    detail: '任务执行完成。连续失败计数已清零。',
    countsTowardFailure: false,
  },
  failed: {
    category: 'failure',
    icon: '❌',
    label: '失败',
    detail: '任务真的跑了但失败了。这次计入连续失败：累计 3 次会自动降频。',
    countsTowardFailure: true,
  },
  timeout: {
    category: 'failure',
    icon: '❌',
    label: '超时',
    detail: '达到硬超时被强制结束，按失败处理。这次计入连续失败；可在规则里调大超时档位。',
    countsTowardFailure: true,
  },
  skippedAuth: {
    category: 'skipped',
    icon: '⏭️',
    label: '跳过',
    detail:
      '该 runtime 的凭证已过期或被吊销，本次未触发。重新授权后会按原调度继续。这次没有执行，不计入连续失败。',
    countsTowardFailure: false,
  },
  skippedPrev: {
    category: 'skipped',
    icon: '⏭️',
    label: '跳过',
    detail:
      '上一次触发的任务当时还在跑，按「跳过」并发策略未再起一个。这次没有执行，不计入连续失败。',
    countsTowardFailure: false,
  },
  missed: {
    category: 'missed',
    icon: '🕳️',
    label: '错过',
    detail:
      '调度器当时没在运行，错过了这个触发时刻。这不是规则失败，按设计也不会补跑（否则凌晨任务会在中午执行）。不计入连续失败。',
    countsTowardFailure: false,
  },
  queued: {
    category: 'waiting',
    icon: '⚠️',
    label: '排队重试中 3/5',
    detail:
      '触发时资源不足，正按 24 分钟间隔重试（最多 5 次，约 2 小时窗口）。还没有结果，不计入连续失败。',
    countsTowardFailure: false,
  },
  running: {
    category: 'running',
    icon: '⏳',
    label: '运行中',
    detail: '任务正在执行。',
    countsTowardFailure: false,
  },
  pending: {
    category: 'waiting',
    icon: '⏳',
    label: '待执行',
    detail: '已触发，正在创建任务。',
    countsTowardFailure: false,
  },
} satisfies Record<string, RunOutcome>;

function make(key: keyof typeof OUTCOMES, overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: `run-${key}`,
    outcome: OUTCOMES[key],
    startedAtText: '8-31 08:00',
    durationText: '1 分 12 秒',
    ...overrides,
  };
}

const meta: Meta<typeof RunHistoryItemView> = {
  title: 'Project/RunHistoryItem',
  component: RunHistoryItemView,
  parameters: { layout: 'padded' },
  args: { row: make('success'), expanded: true, onToggleDetail: fn(), onOpenTask: fn() },
  decorators: [
    (Story) => (
      <ul className="max-w-xl">
        <Story />
      </ul>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof RunHistoryItemView>;

export const Success: Story = {
  args: { row: make('success', { sandboxId: 'sbx-1' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('run-failure-accounting')).toHaveTextContent('不计入');
    await expect(canvas.getByTestId('run-open-task')).toBeInTheDocument();
  },
};

/** ❌ 失败：**唯一**会把规则推向降频/禁用的两类之一。 */
export const Failed: Story = {
  args: { row: make('failed', { outputSummary: 'Error: ENOENT reports/' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('run-failure-accounting')).toHaveTextContent('计入连续失败');
    await expect(canvas.getByTestId('run-output-summary')).toBeInTheDocument();
  },
};

/** ❌ 超时：也计入连续失败，但文案要引导去调超时档位，不是去查代码。 */
export const Timeout: Story = {
  args: { row: make('timeout') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('run-label')).toHaveTextContent('超时');
    await expect(canvas.getByTestId('run-detail')).toHaveTextContent('超时档位');
  },
};

/** ⏭️ 跳过（凭证过期）：要引导用户去重新授权。 */
export const SkippedAuthExpired: Story = {
  args: { row: make('skippedAuth', { durationText: undefined }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('run-detail')).toHaveTextContent('凭证');
    await expect(canvas.getByTestId('run-failure-accounting')).toHaveTextContent('不计入');
  },
};

/** ⏭️ 跳过（上次没跑完）：什么都不用做——与上一条**必须是两句话**。 */
export const SkippedPreviousRunning: Story = {
  args: { row: make('skippedPrev', { durationText: undefined }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('run-detail')).toHaveTextContent('上一次');
    await expect(canvas.getByTestId('run-detail')).not.toHaveTextContent('凭证');
  },
};

/**
 * ⭐ 🕳️ 错过：**这一页最容易被误读的一格**。
 * 它的意思是"调度器当时没在运行"，既不是规则的错，也不会补跑。
 */
export const Missed: Story = {
  args: { row: make('missed', { durationText: undefined }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const item = canvas.getByTestId('run-history-item');
    // ⭐ 自成一类：⛔ 不能与 skipped 合并，也绝不能与 failure 同色同类。
    await expect(item).toHaveAttribute('data-category', 'missed');
    await expect(item).toHaveAttribute('data-counts-toward-failure', 'false');
    await expect(canvas.getByTestId('run-detail')).toHaveTextContent('不是规则失败');
    await expect(canvas.getByTestId('run-detail')).toHaveTextContent('不会补跑');
  },
};

/** ⚠️ 资源不足排队：24min × 5，历史上显示「已排队 n/5」。 */
export const ResourceExhausted: Story = {
  args: { row: make('queued', { durationText: undefined }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('run-label')).toHaveTextContent('3/5');
    await expect(canvas.getByTestId('run-history-item')).toHaveAttribute(
      'data-counts-toward-failure',
      'false',
    );
  },
};

export const Running: Story = {
  args: { row: make('running', { durationText: undefined }) },
};

export const Pending: Story = {
  args: { row: make('pending', { durationText: undefined }) },
};

/** ⭐ webhook 投递失败：**不影响规则状态**，那半句话必须在（P21-7 §9.1 #30）。 */
export const WebhookDeliveryFailed: Story = {
  args: {
    row: make('failed', {
      webhookNote: 'Webhook 投递失败（重试 2 次后放弃）。仅通知未送出，规则状态不受影响。',
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('run-webhook-note')).toHaveTextContent(
      '规则状态不受影响',
    );
  },
};

/** 契约暂缺 sandboxId：⛔ 不摆一个点了没反应的 [打开 Task]。 */
export const NoTaskLink: Story = {
  args: { row: make('success') },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('run-open-task')).toBeNull();
  },
};
