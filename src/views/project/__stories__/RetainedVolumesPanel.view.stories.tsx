// F21-6 §3.3「🎁 已保留卷」的状态矩阵逐格落成 variant。
// ⚠️ 写了 play 的都是**真断言**，其中三条是否定性的：没有「恢复」、下载是 `<a download>`、
//    两个大小一个都不少。这三条正是这个界面最容易被"顺手简化"掉的地方（见 view 文件头）。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { RetainedVolumesPanelView } from '@/views/project/RetainedVolumesPanel.view';
import type { RetainedVolumeRow, RetainedVolumeTotals } from '@/types/retainedVolume';

const archiveUrl = (id: string): string => `/api/retained-volumes/${id}/archive`;

/**
 * ⚠️ 两个大小的差是**实测值**（10 §6：web 工作区磁盘 1.0 GB / tar 14 MB，差 70 倍）。
 * 替身里如果把它们编成相近的两个数，"只显示一个就够了"这个错误在 Storybook 里看不出问题。
 */
const ROW_A: RetainedVolumeRow = {
  id: 'rv-1',
  sandboxId: 'sbx-7f3a',
  originText: '来源任务 sbx-7f3a',
  sourceText: '销毁任务时保留',
  retainedAtText: '2026/8/25 10:12:00',
  diskText: '1.0 GB',
  downloadText: '14 MB',
  countdownText: '还需 27 天',
  urgent: false,
};

/** 弱引用断掉的那条：sandbox 记录归档后 `sandboxId` 为空，卷仍可管理（10 §7.3）。 */
const ROW_ORPHAN: RetainedVolumeRow = {
  id: 'rv-2',
  originText: '来源任务已归档',
  sourceText: '自动化产物',
  retainedAtText: '2026/8/01 09:00:00',
  diskText: '320 MB',
  downloadText: '3.0 MB',
  countdownText: '不足 1 天',
  urgent: true,
};

const TOTALS: RetainedVolumeTotals = { count: 2, diskText: '1.3 GB', downloadText: '17 MB' };
const EMPTY_TOTALS: RetainedVolumeTotals = { count: 0, diskText: '0 B', downloadText: '0 B' };

const meta: Meta<typeof RetainedVolumesPanelView> = {
  title: 'Project/RetainedVolumesPanel',
  component: RetainedVolumesPanelView,
  parameters: { layout: 'fullscreen' },
  args: {
    projectName: 'acme-web',
    rows: [ROW_A, ROW_ORPHAN],
    totals: TOTALS,
    loading: false,
    archiveUrl,
    onDelete: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof RetainedVolumesPanelView>;

/**
 * 常态两条。**play 钉住这个界面的三条硬规格**：
 * ① 每行两个大小都在（只给一个必然误导，10 §6）；
 * ② [下载] 是 `<a href download>`——浏览器原生下载栏 + 另存为，前端零代码；
 * ③ **没有「恢复」**（P20 §6：语义未裁，连禁用态都不摆）。
 */
export const TwoVolumes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // ① 两个大小并排，各带标签。
    const sizes = canvas.getAllByTestId('retained-volume-sizes');
    await expect(sizes).toHaveLength(2);
    await expect(sizes[0]).toHaveTextContent('占用 1.0 GB');
    await expect(sizes[0]).toHaveTextContent('下载 14 MB');

    // ② 下载是原生锚点：有 href、有 download 属性，且**不是** <button>。
    const links = canvas.getAllByTestId('retained-volume-download');
    await expect(links[0]).toHaveAttribute('href', '/api/retained-volumes/rv-1/archive');
    await expect(links[0]).toHaveAttribute('download');
    await expect(links[0]?.tagName).toBe('A');

    // ③ 否定性：本轮不做「恢复」。
    await expect(canvas.queryByText(/恢复/)).toBeNull();

    // 合计同样两个数都给。
    await expect(canvas.getByTestId('retained-volumes-totals')).toHaveTextContent(
      '共 2 个 · 占用 1.3 GB · 全部下载 17 MB',
    );
  },
};

/** 快到期的那条突出显示（下载窗口快关了）；不急的那条保持低调。 */
export const ExpiringSoon: Story = {
  args: { rows: [ROW_ORPHAN], totals: { count: 1, diskText: '320 MB', downloadText: '3.0 MB' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('retained-volume-countdown')).toHaveTextContent('不足 1 天');
    // 弱引用断掉时给的是一句话，不是空格子（空格子会被读成"加载失败"）。
    await expect(canvas.getByText('来源任务已归档')).toBeInTheDocument();
  },
};

/**
 * 删除必须过二次确认：第一下只把行**展开成确认态**，`onDelete` 一次都不该被调用。
 * 这是否定性断言 —— 一步删除是不可逆操作里最常见的事故。
 */
export const DeleteNeedsConfirm: Story = {
  args: {
    rows: [ROW_A],
    totals: { count: 1, diskText: '1.0 GB', downloadText: '14 MB' },
    onDelete: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: '删除' }));
    // ⭐ 第一下**不删**：只展开确认态。一步删除是不可逆操作里最常见的事故。
    await expect(args.onDelete).not.toHaveBeenCalled();
    await expect(canvas.getByText('永久删除？删掉后这份工作区不可恢复。')).toBeInTheDocument();

    await userEvent.click(canvas.getByRole('button', { name: '确认删除' }));
    await expect(args.onDelete).toHaveBeenCalledWith('rv-1');
  },
};

/** 正在删除的那一条禁用；**其余行照常可用**（不整面板禁用）。 */
export const Deleting: Story = {
  args: { deletingId: 'rv-1' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '删除中…' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: '删除' })).toBeEnabled();
  },
};

/** 空态：说清楚"卷是怎么来的"，否则用户不知道下次该怎么留下成果。 */
export const Empty: Story = {
  args: { rows: [], totals: EMPTY_TOTALS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const empty = canvas.getByTestId('retained-volumes-empty');
    await expect(empty).toHaveTextContent('这个项目还没有已保留卷。');
    // 空态要说清"卷是怎么来的"，否则用户不知道下次该怎么留下成果。
    await expect(empty).toHaveTextContent('勾选「保留工作区卷」');
    // 空态不摆任何合计行（"共 0 个 · 占用 0 B" 是噪声）。
    await expect(canvas.queryByTestId('retained-volumes-totals')).toBeNull();
  },
};

/** 加载中：不是空态（"还没有保留卷"与"还没读到"必须分开说）。 */
export const Loading: Story = {
  args: { rows: [], totals: EMPTY_TOTALS, loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('retained-volumes-loading')).toBeInTheDocument();
    await expect(canvas.queryByTestId('retained-volumes-empty')).toBeNull();
  },
};

/** 列表取不回来：红字，且**不冒充空态**。 */
export const LoadFailed: Story = {
  args: { rows: [], totals: EMPTY_TOTALS, loadErrorMessage: '网络错误，请稍后重试。' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('网络错误，请稍后重试。');
    await expect(canvas.queryByTestId('retained-volumes-empty')).toBeNull();
  },
};

/** 删除失败（如已被 VolumeReaper 清掉）：给人话，列表照常可读。 */
export const DeleteFailed: Story = {
  args: { actionErrorMessage: '这个保留卷已经不存在了（可能刚被自动清理）。' },
};
