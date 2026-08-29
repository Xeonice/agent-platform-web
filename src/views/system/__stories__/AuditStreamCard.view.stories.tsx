import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { AuditStreamCardView } from '@/views/system/AuditStreamCard.view';
import { AuditFilterBarView } from '@/views/system/AuditFilterBar.view';
import type { AuditRowModel } from '@/types/audit';

const SEVERITIES = ['info', 'info', 'warn', 'info', 'error'] as const;

function rows(count: number, startSeq = 1200): AuditRowModel[] {
  return Array.from({ length: count }, (_, i) => {
    const seq = startSeq - i;
    const severity = SEVERITIES[i % SEVERITIES.length] ?? 'info';
    const base: AuditRowModel = {
      seq,
      timeText: `13:45:${String(30 - (i % 30)).padStart(2, '0')}.${String(100 + i).slice(0, 3)}`,
      severity,
      summary: `沙箱 sb-${String((i % 5) + 1)} 完成 workspace 准备（#${String(seq)}）`,
      actorText: '系统',
      durationText: `${String(1 + (i % 9))}.${String(i % 10)}s`,
    };
    if (severity === 'error') {
      return {
        ...base,
        summary: `沙箱 sb-1 创建失败：provider 不可用`,
        errorCode: 'PROVIDER_UNAVAILABLE',
      };
    }
    if (i % 3 === 0) return { ...base, detailText: '{\n  "stage": "workspace"\n}' };
    return base;
  });
}

const filterBar = (
  <AuditFilterBarView
    alertsOnly={false}
    fromLocal=""
    toLocal=""
    onCategoryChange={() => undefined}
    onAlertsOnlyChange={() => undefined}
    onFromChange={() => undefined}
    onToChange={() => undefined}
  />
);

const meta: Meta<typeof AuditStreamCardView> = {
  title: 'System/AuditStreamCard',
  component: AuditStreamCardView,
  parameters: { layout: 'padded' },
  args: {
    rows: rows(20),
    isPending: false,
    isError: false,
    isLiveUpdateError: false,
    filterBar,
    emptyKind: 'no-records',
    filterSummary: '当前无筛选条件（全部类别、全部严重度）',
    gap: null,
    gapIndex: null,
    isFillingGap: false,
    hasOlder: true,
    isFetchingOlder: false,
    expandedSeq: null,
    onToggleDetail: fn(),
    onOpenTimeline: fn(),
    onFillGap: fn(),
    onReachEnd: fn(),
    onRetry: fn(),
    onRetryLiveUpdate: fn(),
    onClearFilters: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-[960px] max-w-full">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof AuditStreamCardView>;

export const Loading: Story = {
  args: { rows: [], isPending: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 骨架 × 5，**不是整块 spinner**：列表有稳定高度，筛选切换时页面不跳。
    await expect(canvas.getAllByTestId('audit-skeleton-row')).toHaveLength(5);
  },
};

export const TwentyRows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId(/^audit-row-/)).toHaveLength(20);
    await expect(canvas.queryByTestId('audit-gap-notice')).toBeNull();
  },
};

export const Empty: Story = {
  args: { rows: [], hasOlder: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 空态是「暂无记录」**加上当前筛选说明**，不是空白（空白让人以为坏了）。
    await expect(canvas.getByText('暂无记录')).toBeInTheDocument();
    await expect(canvas.getByText(/当前无筛选条件/)).toBeInTheDocument();
    // 三态互相可区分：另外两句一句都不许冒出来。
    await expect(canvas.queryByText('当前筛选无匹配记录')).toBeNull();
    await expect(canvas.queryByText('该类事件平台尚未记录')).toBeNull();
    // 真·无记录**没有** [清除筛选]（没有筛选可清；给了反而暗示"是你筛掉的"）。
    await expect(canvas.queryByRole('button', { name: '清除筛选' })).toBeNull();
  },
};

export const FilteredEmpty: Story = {
  args: {
    rows: [],
    hasOlder: false,
    emptyKind: 'filtered-out',
    filterSummary: '类别：凭证 · 仅告警',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 与另外两句**都不同文案**，否则用户以为平台没干活。
    await expect(canvas.getByText('当前筛选无匹配记录')).toBeInTheDocument();
    await expect(canvas.queryByText('暂无记录')).toBeNull();
    await expect(canvas.queryByText('该类事件平台尚未记录')).toBeNull();
    await expect(canvas.getByRole('button', { name: '清除筛选' })).toBeInTheDocument();
  },
};

/**
 * 第三个空态：契约先给出一个类别、后端后补写入点，中间那段窗口里这一类**一条都没有**。
 * 说成「当前筛选无匹配记录」，用户读出来的是"这类操作从来没发生过"，于是他会去徒劳地
 * 调严重度、调时间范围。
 *
 * ⚠️ **2026-08-28 起五个类别后端全部在写**（`AUDIT_CATEGORY_EMIT_STATUS` 全 `emitted`），
 * 这一档因此在真实数据下暂时不可达 ⇒ **这个 story 是它唯一还活着的渲染现场**。
 * story 是 props 驱动的，构造这个态既不需要假装后端不写、也不需要动生产代码。
 * ⛔ 不许因为"当前没有真实实例"就删掉它：类别是开放增长的（`automation` 是 v1.1、
 * `sandbox.health` 也还空着），下一个类别落地前照样有那段窗口。
 * `filterSummary` 这里仍写「类别：镜像」——它只是这一档的一个示例文案，不是对现状的断言。
 */
export const CategoryNotYetEmitted: Story = {
  args: {
    rows: [],
    hasOlder: false,
    emptyKind: 'category-not-yet-emitted',
    filterSummary: '类别：镜像',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('该类事件平台尚未记录')).toBeInTheDocument();
    // ⛔ 两条否定断言是关键：**两句话同时渲染时，上面那条肯定断言照样绿。**
    await expect(canvas.queryByText('当前筛选无匹配记录')).toBeNull();
    await expect(canvas.queryByText('暂无记录')).toBeNull();
    // 「没筛到」与「没记过」的区别要说出来，否则用户会去徒劳地调严重度与时间范围。
    await expect(canvas.getByText(/这不代表相关操作没有发生/)).toBeInTheDocument();
    // 出路还在。
    await expect(canvas.getByRole('button', { name: '清除筛选' })).toBeInTheDocument();
  },
};

export const Failed: Story = {
  args: { rows: [], isError: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('❌ 审计流加载失败')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: '重试' })).toBeInTheDocument();
    // ⛔ 失败**绝不**退化成「暂无记录」——那是本页最坏的谎。
    await expect(canvas.queryByText('暂无记录')).toBeNull();
    await expect(canvas.queryByText('当前筛选无匹配记录')).toBeNull();
    await expect(canvas.queryByText('该类事件平台尚未记录')).toBeNull();
  },
};

export const WithGap: Story = {
  args: {
    rows: [...rows(3, 1587), ...rows(4, 1200)],
    gap: { afterSeq: 1200, beforeSeq: 1585 },
    gapIndex: 3,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const notice = canvas.getByTestId('audit-gap-notice');
    // 夹在两段之间：上面是刚 prepend 的增量（1587–1585），下面是原有历史（1200–…）。
    // ⚠️ 整串逐位比对，不只看邻居：`gapIndex` 差一位就等于告诉用户"漏的是另一段"，
    // 而只断言"提示的上一个是 1585"在插到 1586 之后时**照样绿**。
    const ids = [...(notice.parentElement?.children ?? [])].map((el) =>
      el.getAttribute('data-testid'),
    );
    await expect(ids).toEqual([
      'audit-row-1587',
      'audit-row-1586',
      'audit-row-1585',
      'audit-gap-notice',
      'audit-row-1200',
      'audit-row-1199',
      'audit-row-1198',
      'audit-row-1197',
    ]);
  },
};

export const LiveUpdateInterrupted: Story = {
  args: { isLiveUpdateError: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 「静默停止更新」与「没有新事件」是两回事，必须说出来（§3A ⑦）。
    await expect(canvas.getByTestId('audit-live-update-error')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: '重试' })).toBeInTheDocument();
    // ⛔ 关键是这三条否定/肯定的组合：**它是一行，不是一块**——列表照旧全在，
    //    也不许顺手把整块「审计流加载失败」搬过来（那把一次轮询失败放大成面板不可用）。
    await expect(canvas.getAllByTestId(/^audit-row-/)).toHaveLength(20);
    await expect(canvas.queryByText('❌ 审计流加载失败')).toBeNull();
  },
};

export const EmptyWithOlder: Story = {
  args: {
    rows: [],
    emptyKind: 'filtered-out',
    filterSummary: '类别：凭证 · 仅告警',
    hasOlder: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⚠️ 空列表与"还有更早的"是**两件事**：被告知还有更老的一页时，
    // 入口就必须在——把 footer 关进 `rows.length > 0` 的分支里，用户看到的是
    // 「当前筛选无匹配记录」**且没有任何继续加载的入口**，读出来的结论是"没有"。
    await expect(canvas.getByText('当前筛选无匹配记录')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: '加载更早的记录' })).toBeInTheDocument();
  },
};

export const ReachedOldest: Story = {
  args: { rows: rows(4), hasOlder: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 到底就说到底，不再挂一个永远转的 spinner。
    await expect(canvas.getByText('已到最早记录')).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: '加载更早的记录' })).toBeNull();
  },
};

export const ExpandedRow: Story = {
  args: { expandedSeq: 1200 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const panel = canvas.getByTestId('audit-detail-panel');
    await expect(panel.closest('li')).toBe(canvas.getByTestId('audit-row-1200'));
  },
};
