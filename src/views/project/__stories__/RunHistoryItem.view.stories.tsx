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
    label: '成功',
    detail: '任务跑完了，成功。之前累计的失败次数已经清零。',
    countsTowardFailure: false,
  },
  failed: {
    category: 'failure',
    label: '失败',
    detail: '任务真的跑起来了，但没跑成。这次算一次失败：累计 3 次会自动放慢（每天只试一次）。',
    countsTowardFailure: true,
  },
  timeout: {
    category: 'failure',
    label: '超时',
    detail:
      '跑到了规则里设的最长运行时间，被强制结束，按失败处理。这次算一次失败；可以在规则里把最长运行时间调大一档。',
    countsTowardFailure: true,
  },
  skippedAuth: {
    category: 'skipped',
    label: '跳过',
    detail:
      '这个 Agent 的凭证已过期或被吊销，本次没有触发。重新授权后会按原来的时间表继续。这次没有执行，不算失败。',
    countsTowardFailure: false,
  },
  skippedPrev: {
    category: 'skipped',
    label: '跳过',
    detail:
      '上一次触发的任务当时还在跑，按「跳过」的策略这次没有再起一个。这次没有执行，不算失败。',
    countsTowardFailure: false,
  },
  missed: {
    category: 'missed',
    label: '错过',
    detail:
      '平台的定时调度当时没在运行，错过了这个时刻。这不是规则的问题；按设计也不会补跑（补跑会让凌晨的任务在中午执行）。这次不算失败。',
    countsTowardFailure: false,
  },
  queued: {
    category: 'waiting',
    label: '排队重试中 3/5',
    detail:
      '触发的时候没有空闲资源，正在按 24 分钟一次的间隔排队重试（最多 5 次）。还没有结果，这次不算失败。',
    countsTowardFailure: false,
  },
  running: {
    category: 'running',
    label: '运行中',
    detail: '任务正在跑。',
    countsTowardFailure: false,
  },
  pending: {
    category: 'waiting',
    label: '待执行',
    detail: '已经触发，正在创建任务。',
    countsTowardFailure: false,
  },
  exhausted: {
    category: 'failure',
    label: '没排到资源',
    detail:
      '一直没排到资源，等了 5 次还是没跑起来，这一次就不再等了。任务没有真正开始，所以没有输出可看。这次算一次失败：累计 3 次会自动放慢（每天只试一次）。',
    countsTowardFailure: true,
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
    await expect(canvas.getByTestId('run-failure-accounting')).toHaveTextContent('不算失败');
    await expect(canvas.getByTestId('run-open-task')).toBeInTheDocument();
    // MUTATION：把 `CATEGORY_ICON` 换回 emoji 字符或改到另一个图标 ⇒ 下面两条先红——
    // 只锁 `run-label` 文案在两种写法下都绿，锁不住"真的换成了哪个图标组件"。
    const icon = canvas.getByTestId('run-outcome-icon');
    await expect(icon).toHaveAttribute('data-outcome-category', 'success');
    await expect(icon.classList.contains('lucide-check')).toBe(true);
    // 「算一次失败」的 ⚠️ 已换成 AlertTriangle，success 不算失败 ⇒ 不该渲染这个图标。
    await expect(canvas.getByTestId('run-failure-accounting').querySelector('svg')).toBeNull();
  },
};

/** 失败：**唯一**会把规则推向降频/禁用的两类之一。 */
export const Failed: Story = {
  args: { row: make('failed', { outputSummary: 'Error: ENOENT reports/' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('run-failure-accounting')).toHaveTextContent('算一次失败');
    await expect(canvas.getByTestId('run-output-summary')).toBeInTheDocument();
    const icon = canvas.getByTestId('run-outcome-icon');
    await expect(icon).toHaveAttribute('data-outcome-category', 'failure');
    await expect(icon.classList.contains('lucide-x')).toBe(true);
    // 「算一次失败」这次是 true ⇒ 前面要带一个 AlertTriangle（渲染出的 class 是
    // `lucide-triangle-alert`，不是 `lucide-alert-triangle`）。
    await expect(
      canvas.getByTestId('run-failure-accounting').querySelector('svg.lucide-triangle-alert'),
    ).not.toBeNull();
  },
};

/**
 * ❌ **没排到资源**：`status='failed'` 但 `errorCode='RESOURCE_EXHAUSTED'`。
 *
 * ★ 它**算一次失败，却根本没跑起来** —— 横跨了"有结果·坏"和"没有跑"两类，是八个
 *   status 里唯一一个不能只看 status 就归类的。和普通失败共用一句「任务真的跑了但
 *   失败了」是**假的**：用户会去翻一份不存在的日志。
 */
export const GaveUpNoCapacity: Story = {
  args: { row: make('exhausted') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('run-label')).toHaveTextContent('没排到资源');
    await expect(canvas.getByTestId('run-detail')).toHaveTextContent('没有输出');
    await expect(canvas.getByTestId('run-detail')).not.toHaveTextContent('跑起来了');
    // 后端确实记了这一笔 ⇒ ⛔ 界面不许替它改口径。
    await expect(canvas.getByTestId('run-failure-accounting')).toHaveTextContent('算一次失败');
  },
};

/**
 * ⭐ **失败原文单独一格**（`automation_runs.error_message`）。
 *
 * 它此前解析了却从不渲染 ⇒ 失败原因永远只有一句通用话。两者都要：`run-detail` 说
 * "这属于哪一类失败"，这一格说"到底哪一步炸的"。⚠️ 它是后端原文（英文/异常 message），
 * 所以带标签、次要样式，⛔ 不许当人话摆到 `run-detail` 的位置上。
 */
export const FailedWithErrorMessage: Story = {
  args: {
    row: make('failed', {
      errorMessage: 'task exited with code 1: ENOENT ./scripts/nightly.sh',
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('run-error-message')).toHaveTextContent('ENOENT');
    await expect(canvas.getByTestId('run-error-message')).toHaveTextContent('后端原文');
    // 人话那一句仍然在。
    await expect(canvas.getByTestId('run-detail')).toHaveTextContent('算一次失败');
  },
};

/** 没有 errorMessage 的行 ⛔ 不摆一个空的原文块。 */
export const NoErrorMessage: Story = {
  args: { row: make('success') },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('run-error-message')).toBeNull();
  },
};

/** ❌ 超时：也算一次失败，但文案要引导去调「最长运行时间」，不是去查代码。 */
export const Timeout: Story = {
  args: { row: make('timeout') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('run-label')).toHaveTextContent('超时');
    await expect(canvas.getByTestId('run-detail')).toHaveTextContent('最长运行时间');
  },
};

/** 跳过（凭证过期）：要引导用户去重新授权。 */
export const SkippedAuthExpired: Story = {
  args: { row: make('skippedAuth', { durationText: undefined }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('run-detail')).toHaveTextContent('凭证');
    await expect(canvas.getByTestId('run-failure-accounting')).toHaveTextContent('不算失败');
    const icon = canvas.getByTestId('run-outcome-icon');
    await expect(icon).toHaveAttribute('data-outcome-category', 'skipped');
    await expect(icon.classList.contains('lucide-minus')).toBe(true);
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
 * ⭐ 错过：**这一页最容易被误读的一格**。
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
    await expect(canvas.getByTestId('run-detail')).toHaveTextContent('不是规则的问题');
    await expect(canvas.getByTestId('run-detail')).toHaveTextContent('不会补跑');
    // `missed` 用的是 `Circle`（与 `StatusPill` 的 `unknown` 态同款——八态里没有专门
    // 表达"错过"的一态，选它是因为视觉权重最轻，见 RunHistoryItem.view.tsx 的注释）。
    const icon = canvas.getByTestId('run-outcome-icon');
    await expect(icon).toHaveAttribute('data-outcome-category', 'missed');
    await expect(icon.classList.contains('lucide-circle')).toBe(true);
  },
};

/**
 * ⚠️ 资源不足**排队中**：24min × 5，显示「排队 n/5」。
 * ⛔ 与上面的 `GaveUpNoCapacity`（排完了、放弃了）是两件事：这一支还没有结果、不算失败，
 *   那一支算一次失败。同一个词出现在两处，文案与 `countsTowardFailure` 都必须分得开。
 */
export const QueuedForCapacity: Story = {
  args: { row: make('queued', { durationText: undefined }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('run-label')).toHaveTextContent('3/5');
    await expect(canvas.getByTestId('run-history-item')).toHaveAttribute(
      'data-counts-toward-failure',
      'false',
    );
    // `waiting`/`running` 统一用会转的 `Loader2`（与 `StatusPill` 的 `pending` 态同款
    // 图标）——都是"还没有结果"，⛔ 不应该看起来像告警（此前是 ⚠️）。
    const icon = canvas.getByTestId('run-outcome-icon');
    await expect(icon).toHaveAttribute('data-outcome-category', 'waiting');
    await expect(icon.classList.contains('lucide-loader-circle')).toBe(true);
    await expect(icon.classList.contains('animate-spin')).toBe(true);
  },
};

export const Running: Story = {
  args: { row: make('running', { durationText: undefined }) },
  play: async ({ canvasElement }) => {
    const icon = within(canvasElement).getByTestId('run-outcome-icon');
    await expect(icon).toHaveAttribute('data-outcome-category', 'running');
    await expect(icon.classList.contains('lucide-loader-circle')).toBe(true);
    await expect(icon.classList.contains('animate-spin')).toBe(true);
  },
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
