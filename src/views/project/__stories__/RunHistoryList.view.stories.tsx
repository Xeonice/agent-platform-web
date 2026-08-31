// F21-7 §7.2：10 条 + [查看全部] · 空历史 · 取不回来。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { RunHistoryListView } from '@/views/project/RunHistoryList.view';
import type { RunOutcome, RunRow } from '@/types/automation';

const OK: RunOutcome = {
  category: 'success',
  icon: '✅',
  label: '成功',
  detail: '任务执行完成。连续失败计数已清零。',
  countsTowardFailure: false,
};

const ROWS: RunRow[] = Array.from({ length: 25 }, (_, i) => ({
  id: `run-${String(i)}`,
  outcome: OK,
  startedAtText: `8-${String(31 - (i % 30))} 08:00`,
  durationText: '1 分 12 秒',
}));

const meta: Meta<typeof RunHistoryListView> = {
  title: 'Project/RunHistoryList',
  component: RunHistoryListView,
  parameters: { layout: 'padded' },
  args: {
    rows: ROWS,
    previewRows: ROWS.slice(0, 10),
    loading: false,
    hasMore: true,
    loadingMore: false,
    onLoadMore: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof RunHistoryListView>;

/** 折叠态只给最近 10 条（P21-7 §3.3）；[查看全部] 才铺开。 */
export const CollapsedTen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('run-history-item')).toHaveLength(10);
    // ⭐ 还有下一页时**不许说「共」** —— 游标分页拿不到总数（后端刻意不回：append-only
    //    流的总数每刻都在变），拿已加载条数去填「共 N 次」就是撒谎。
    await expect(canvas.getByTestId('run-history-total')).toHaveTextContent('已加载 25 次');

    await userEvent.click(canvas.getByTestId('run-history-show-all'));
    await expect(canvas.getAllByTestId('run-history-item')).toHaveLength(25);
    await expect(canvas.getByTestId('run-history-load-more')).toBeInTheDocument();
  },
};

/** 已加载完（hasMore=false）→ 不给 [加载更多]（点了没反应的按钮比没有更糟）；**这时才敢说「共」**。 */
export const AllLoaded: Story = {
  args: { rows: ROWS.slice(0, 8), previewRows: ROWS.slice(0, 8), hasMore: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('run-history-total')).toHaveTextContent('共 8 次');
    await expect(canvas.getAllByTestId('run-history-item')).toHaveLength(8);
    await expect(canvas.queryByTestId('run-history-show-all')).toBeNull();
    await expect(canvas.queryByTestId('run-history-load-more')).toBeNull();
  },
};

export const EmptyHistory: Story = {
  args: { rows: [], previewRows: [], hasMore: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('run-history-empty')).toBeInTheDocument();
  },
};

/** ⭐ 取不回来 ≠ 还没运行过：一次 500 被"还没运行过"盖住是本页第二坏的谎。 */
export const LoadFailed: Story = {
  args: {
    rows: [],
    previewRows: [],
    hasMore: false,
    loadErrorMessage: '网络错误，请稍后重试。',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('run-history-error')).toBeInTheDocument();
    await expect(canvas.queryByTestId('run-history-empty')).toBeNull();
  },
};
