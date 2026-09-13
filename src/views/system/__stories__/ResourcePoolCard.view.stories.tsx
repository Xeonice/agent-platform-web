import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { ResourcePoolCardView } from '@/views/system/ResourcePoolCard.view';
import type { ResourcePoolCardModel } from '@/types/system';

function model(over: Partial<ResourcePoolCardModel> = {}): ResourcePoolCardModel {
  return {
    gauges: [
      { id: 'cpu', label: 'CPU', level: 'ok', usedPercent: 52.5, amountText: '4.2 / 8 核' },
      { id: 'ram', label: '内存', level: 'ok', usedPercent: 36.3, amountText: '5.8 / 16 GB' },
      {
        id: 'disk',
        label: '磁盘',
        level: 'ok',
        usedPercent: 60,
        amountText: '120 / 200 GB',
        pathText: '/data',
      },
    ],
    overallLevel: 'ok',
    overallText: '资源充足',
    activeTasks: 5,
    reservedPercent: 15,
    retained: {
      count: 12,
      level: 'ok',
      sizeText: '45 GB',
      shareText: '占 DATA_ROOT 的 22.5%',
      countdownText: '最早的成果还需 6 天清理',
      truncated: false,
    },
    showCleanupRetained: false,
    ...over,
  };
}

const meta: Meta<typeof ResourcePoolCardView> = {
  title: 'System/ResourcePoolCard',
  component: ResourcePoolCardView,
  parameters: { layout: 'padded' },
  args: {
    model: model(),
    isError: false,
    isRefreshing: false,
    onRefresh: fn(),
    onCleanupRetained: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof ResourcePoolCardView>;

export const Healthy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('资源充足')).toBeInTheDocument();
    // 三个维度各自可读（不是只给一个总数）。
    await expect(canvas.getByTestId('resource-gauge-cpu')).toBeInTheDocument();
    await expect(canvas.getByTestId('resource-gauge-ram')).toBeInTheDocument();
    await expect(canvas.getByTestId('resource-gauge-disk')).toBeInTheDocument();
    // 健康时不给 [清理保留卷]（那是磁盘/保留卷告警时才有意义的出路）。
    await expect(canvas.queryByRole('button', { name: '清理保留卷' })).not.toBeInTheDocument();
  },
};

export const Warning: Story = {
  args: {
    model: model({
      gauges: [
        { id: 'cpu', label: 'CPU', level: 'warn', usedPercent: 86, amountText: '6.9 / 8 核' },
        { id: 'ram', label: '内存', level: 'ok', usedPercent: 40, amountText: '6.4 / 16 GB' },
        {
          id: 'disk',
          label: '磁盘',
          level: 'ok',
          usedPercent: 60,
          amountText: '120 / 200 GB',
          pathText: '/data',
        },
      ],
      overallLevel: 'warn',
      overallText: '资源紧张，建议停止部分 Task',
    }),
  },
};

/** ⭐ 磁盘 96% 而 CPU/RAM 正常 —— **整体必须是耗尽**（取最差维度，不是平均）。 */
export const DiskOnlyCritical: Story = {
  args: {
    model: model({
      gauges: [
        { id: 'cpu', label: 'CPU', level: 'ok', usedPercent: 10, amountText: '0.8 / 8 核' },
        { id: 'ram', label: '内存', level: 'ok', usedPercent: 20, amountText: '3.2 / 16 GB' },
        {
          id: 'disk',
          label: '磁盘',
          level: 'critical',
          usedPercent: 96,
          amountText: '192 / 200 GB',
          pathText: '/data',
        },
      ],
      overallLevel: 'critical',
      overallText: '资源耗尽，无法创建新 Task',
      showCleanupRetained: true,
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⚠️ 平均（10+20+96)/3 = 42% 会被算成"充足"——而这台机器一个 Task 都建不出来。
    await expect(canvas.getByText('资源耗尽，无法创建新 Task')).toBeInTheDocument();
    await expect(canvas.queryByText('资源充足')).not.toBeInTheDocument();
    // 磁盘触发时要有它**自己的**出路：停 Task 不释放保留卷。
    await expect(canvas.getByRole('button', { name: '清理保留卷' })).toBeInTheDocument();
    // ⭐ design/design-notes.md §4 Phase 1：`critical` 映射到 `StatusPill` 的 `fail`
    // （红），不是 `warn`（琥珀）——磁盘/CPU/内存耗尽与"确定坏了"共用同一套视觉严重度。
    // MUTATION：把 `ResourcePoolCard.view.tsx` 里 `LEVEL_PILL_STATUS.critical` 从
    // `'fail'` 改成 `'warn'` ⇒ 这两条其中一条会红（磁盘那一行的 pill 颜色、以及整体
    // 那一行的 pill 颜色都会变成 warn）。
    await expect(
      canvas.getByTestId('resource-gauge-disk').querySelector('[data-status]'),
    ).toHaveAttribute('data-status', 'fail');
    await expect(
      canvas.getByTestId('resource-overall').querySelector('[data-status]'),
    ).toHaveAttribute('data-status', 'fail');
  },
};

/**
 * ⭐ 真实布局 bug 回归：磁盘的挂载路径可以比 `/data` 长得多（如
 * `/Users/xxx/Library/Application Support/agent-platform/data-root`）。此前
 * `resourceModel.ts` 把它拼进 `label`（`磁盘（${path}）`），在窄一点的卡片宽度下会把
 * 状态行撑到换行，连带把「正常」pill 挤成两行。⇒ 路径必须独立成行、且允许截断，
 * 不与状态 pill 抢同一行的宽度。
 */
export const DiskPathIsolatedFromLabel: Story = {
  args: {
    model: model({
      gauges: [
        { id: 'cpu', label: 'CPU', level: 'ok', usedPercent: 10, amountText: '0.8 / 8 核' },
        { id: 'ram', label: '内存', level: 'ok', usedPercent: 20, amountText: '3.2 / 16 GB' },
        {
          id: 'disk',
          label: '磁盘',
          level: 'ok',
          usedPercent: 75,
          amountText: '150 / 200 GB',
          pathText:
            '/Users/xeonice/Library/Application Support/agent-platform/very-long-data-root-path-for-layout-regression',
        },
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⚠️ MUTATION：把 view 里 `gauge.label` 换回 `` `磁盘（${gauge.pathText}）` `` 拼接，
    //    这条会先变红——标题行必须**只**是「磁盘」，长路径不许混进同一个文本节点。
    await expect(canvas.getByTestId('resource-gauge-label-disk')).toHaveTextContent('磁盘');
    await expect(canvas.getByTestId('resource-gauge-label-disk')).not.toHaveTextContent(
      'very-long-data-root-path',
    );
    // 路径本身仍然完整可见（只是挪到了自己的一行），⛔ 不是被拿掉了。
    await expect(canvas.getByTestId('resource-gauge-path-disk')).toHaveTextContent(
      'very-long-data-root-path',
    );
  },
};

/** 保留卷统计被截断：报一个确切数字而不说截断，用户清完对不上就再也不信它。 */
export const RetainedTruncated: Story = {
  args: {
    model: model({
      retained: {
        count: 999,
        level: 'warn',
        sizeText: '45 GB',
        shareText: '占 DATA_ROOT 的 80.1%',
        countdownText: '最早的成果不足 1 天后清理',
        truncated: true,
      },
      showCleanupRetained: true,
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/统计已截断/)).toBeInTheDocument();
    // ⭐ ⚠️ 换成了 lucide `AlertTriangle`——渲染出的 class 是 `lucide-triangle-alert`
    // （不是看名字猜的 `lucide-alert-triangle`），保留卷徽标同理换成 `Gift`/`Clock`。
    await expect(canvasElement.querySelector('.lucide-triangle-alert')).not.toBeNull();
    await expect(canvasElement.querySelector('.lucide-gift')).not.toBeNull();
    await expect(canvasElement.querySelector('.lucide-clock')).not.toBeNull();
  },
};

export const ZeroActiveTasks: Story = {
  args: { model: model({ activeTasks: 0 }) },
};

/** ⛔ 失败**不许**退化成一条空水位条（那读起来是"很空闲"）。 */
export const LoadFailed: Story = {
  args: { model: null, isError: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('本机资源读取失败');
    // ⭐ 错误态图标真的换成了 lucide `XCircle`（class `lucide-circle-x`），不再是
    // 标题文案里的字面 ❌ 字符。
    await expect(canvas.getByRole('alert').querySelector('.lucide-circle-x')).not.toBeNull();
    await expect(canvas.queryByText('资源充足')).not.toBeInTheDocument();
    await expect(canvas.queryByTestId('resource-gauge-cpu')).not.toBeInTheDocument();
  },
};

export const Refreshing: Story = {
  args: { isRefreshing: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '刷新中…' })).toBeDisabled();
  },
};
