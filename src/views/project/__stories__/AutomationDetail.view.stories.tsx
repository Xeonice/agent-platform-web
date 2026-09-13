// F21-7 §7.2：配置详情 + 动作 + 运行历史；删除二次确认就地展开。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AutomationDetailView } from '@/views/project/AutomationDetail.view';
import type { AutomationRow, RunOutcome, RunRow } from '@/types/automation';

const ROW: AutomationRow = {
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

const CONFIG = [
  { label: 'Agent', value: 'codex' },
  { label: '什么时候跑', value: '每天 08:00' },
  { label: '时区', value: 'Asia/Shanghai（建规则时定下的，改别的字段不会动它）' },
  { label: '最长运行时间', value: '2 小时' },
  { label: '成果保留期', value: '7 天（存放在项目的「🎁 保留下来的成果」里）' },
  { label: '撞上了怎么办', value: '跳过（上一次还在跑，这一次就不再起一个）' },
  { label: 'Webhook 通知', value: '没开' },
  { label: '连着失败', value: '0 次' },
];

const OK: RunOutcome = {
  category: 'success',
  icon: '✅',
  label: '成功',
  detail: '任务跑完了，成功。之前累计的失败次数已经清零。',
  countsTowardFailure: false,
};

const RUNS: RunRow[] = [
  { id: 'r1', outcome: OK, startedAtText: '8-31 08:00', durationText: '1 分 12 秒' },
  { id: 'r2', outcome: OK, startedAtText: '8-30 08:00', durationText: '58 秒' },
];

const meta: Meta<typeof AutomationDetailView> = {
  title: 'Project/AutomationDetail',
  component: AutomationDetailView,
  parameters: { layout: 'fullscreen' },
  args: {
    row: ROW,
    configLines: CONFIG,
    promptPreview: '汇总昨天的错误日志，输出一份 markdown 报告到 reports/。',
    runs: {
      rows: RUNS,
      previewRows: RUNS,
      loading: false,
      hasMore: false,
      loadingMore: false,
    },
    onBack: fn(),
    onEdit: fn(),
    onToggle: fn(),
    onDelete: fn(),
    onLoadMoreRuns: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof AutomationDetailView>;

export const Enabled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('detail-toggle')).toHaveTextContent('关掉');
    // ⭐ 时区在详情里明说"创建时快照"，用户才知道它为什么不跟着自己的机器变。
    await expect(canvas.getByTestId('detail-config')).toHaveTextContent('建规则时定下的');
    // ⭐ 成果保留期与「🎁 保留下来的成果」互链，不是两套存储（F21-7 §10.4）。
    await expect(canvas.getByTestId('detail-config')).toHaveTextContent('保留下来的成果');
  },
};

/** 🔴 自动禁用：按钮说的是 [重新启用]。 */
export const AutoDisabled: Story = {
  args: {
    row: {
      ...ROW,
      lifecycle: 'autoDisabled',
      icon: '🔴',
      statusText: '连着失败 10 次（放慢后又失败 7 次），已自动停用',
      nextTriggerText: undefined,
      needsAttention: true,
      consecutiveFailures: 10,
    },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('detail-toggle')).toHaveTextContent('重新开启');
  },
};

/**
 * ⭐ 删除二次确认**就地展开**，不叠第二层弹层（P20 §8.4 / F21-7 §2）。
 * 这条 play 是那条纪律的回归：本面板已经活在一层 ModalShell 里。
 */
export const DeleteConfirm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('detail-delete'));
    await expect(canvas.getByTestId('detail-delete-confirm')).toBeInTheDocument();
    // ⛔ 确认区不得是一个新的 dialog。
    await expect(canvas.queryByRole('dialog')).toBeNull();
    // 且要说清"运行历史一并删除"。
    await expect(canvas.getByTestId('detail-delete-confirm')).toHaveTextContent('运行历史');
  },
};

export const RunsLoading: Story = {
  args: {
    runs: {
      rows: [],
      previewRows: [],
      loading: true,
      hasMore: false,
      loadingMore: false,
    },
  },
};
