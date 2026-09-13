// P21-4 §5 的状态矩阵逐格落成 variant。
// ⚠️ 凡是写了 play 的都是**真断言**（F21-4 §7.2 提醒过：仓内 33 个 view story 用 play 的是 0 个，
// 把结构性断言只写进文档等于写进一条没人在跑的路）。这里不写空头支票。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ImageCardView, ImageCardSkeleton } from '@/views/image/ImageCard.view';
import type { ImageCardModel } from '@/types/image';

const noop = (): void => undefined;

const FULL_DIGEST = `sha256:4b17e${'f'.repeat(56)}a02`;
/** 后端今天硬编码的哨兵值——**绝不能出现在 DOM 里**（F21-4 §5.1）。 */
const SENTINEL = 'sha256:unresolved';

/** ⚠️ 警告档：当前真实存在的只有这一种（04 §7 ★ 实测 753 秒）。 */
const CLAUDE_CODE_WARNING = '未预装 claude-code，创建时需现装，实测约 12.5 分钟';

const customWarning: ImageCardModel = {
  id: 'img-ml',
  name: 'ml-agent',
  refDisplay: 'docker.io/myrepo/ml-agent:v1.0',
  refKind: 'tag',
  digestState: 'pinned',
  digestShort: 'sha256:4b17e…a02',
  digestFull: FULL_DIGEST,
  resolvedAtLabel: '解析于 3 天前',
  validationStatus: 'warning',
  warnings: [CLAUDE_CODE_WARNING],
  errors: [],
  supportedRuntimes: ['Codex'],
  isActive: true,
  canDelete: true,
  canCheckUpdate: true,
  // ⭐ 来源（后端 `derivedFromDigest`）—— 此前 DTO 里有、界面上一处不渲染。
  lineage: { kind: 'derived', text: '来源：从预制镜像 sha256:9f2ab…c31 改来的' },
};

/** 预置 AIO：`canDelete:false` ⇒ **不渲染 [删除]**（P21-4 §9）。 */
const builtinValid: ImageCardModel = {
  ...customWarning,
  id: 'img-aio',
  name: 'AIO',
  refDisplay: 'ghcr.io/agent-infra/sandbox:latest',
  digestShort: 'sha256:9f2ab…c31',
  validationStatus: 'valid',
  warnings: [],
  supportedRuntimes: ['Codex', 'Claude Code'],
  canDelete: false,
  resolvedAtLabel: '解析于 2 小时前',
  // 预置镜像**自己就是**来源起点：`derivedFromDigest === null` 在它身上是**事实**，不是缺值。
  lineage: { kind: 'anchor', text: '来源：这就是平台的预制镜像（其他镜像从它改起）' },
};

const meta: Meta<typeof ImageCardView> = {
  title: 'Image/ImageCard',
  component: ImageCardView,
  parameters: { layout: 'padded' },
  args: {
    model: customWarning,
    envSummary: 'LOG_LEVEL=info · CACHE_TTL=3600 · MY_SECRET=***',
    startCommand: 'python -u agent.py',
    onEditRunParams: noop,
    onRevalidate: noop,
    onCheckUpdate: noop,
    onToggle: noop,
    onDelete: noop,
    onViewRequirements: noop,
    onViewUpstreamChange: noop,
    onCopyDigest: noop,
  },
};
export default meta;

type Story = StoryObj<typeof ImageCardView>;

/** ① 加载中：列表 `isPending` → **卡片骨架**（F21-4 §6）。 */
export const LoadingSkeleton: Story = {
  render: () => <ImageCardSkeleton />,
};

/** ② ✅ 有效 · 预置 AIO —— play：**没有 [删除] 按钮**，只留 [禁用]（P21-4 §9）。 */
export const ValidBuiltin: Story = {
  args: { model: builtinValid },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: '删除' })).toBeNull();
    await expect(canvas.getByRole('button', { name: '禁用' })).toBeInTheDocument();
    const icon = canvas.getByTestId('enable-state-icon');
    await expect(icon).toHaveAttribute('data-active', 'true');
    await expect(icon.classList.contains('lucide-circle')).toBe(true);
    await expect(icon.classList.contains('text-success')).toBe(true);
  },
};

/** ② ✅ 有效 · 自定义 —— play：有 [删除]（与预置态形成对照，两条一起才守得住）。 */
export const ValidCustom: Story = {
  args: { model: { ...builtinValid, id: 'img-x', name: 'my-agent', canDelete: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '删除' })).toBeInTheDocument();
  },
};

/** ③ ⚠️ 警告：黄色 + **后果说明**，仍可用。 */
export const Warning: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('validation-result')).toHaveAttribute('data-status', 'warning');
    await expect(canvas.getByText(CLAUDE_CODE_WARNING)).toBeInTheDocument();
  },
};

/** ④ ❌ 无效：红 + errors 列表 + [查看镜像要求]，标记不可用于创建。 */
export const Invalid: Story = {
  args: {
    model: {
      ...customWarning,
      validationStatus: 'invalid',
      warnings: [],
      errors: ['镜像内缺少 tmux —— 平台一重启就会丢掉正在跑的 agent 会话，不做静默降级'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('validation-result')).toHaveAttribute('data-status', 'invalid');
    await expect(canvas.getByRole('button', { name: '查看镜像要求' })).toBeInTheDocument();
  },
};

/**
 * ⑤ 验证中（[重新验证] loading）——
 * play：**卡片其余部分保持可读**，digest / 解析时间 / 三态结论一个字不改（F21-4 §5.1「不做乐观更新」）。
 */
export const Revalidating: Story = {
  args: { revalidating: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('revalidating-spinner')).toBeInTheDocument();
    // 不整卡骨架屏：骨架不存在，且原结论、digest、解析时间原样还在。
    await expect(canvas.queryByTestId('image-card-skeleton')).toBeNull();
    await expect(canvas.getByTestId('validation-result')).toHaveAttribute('data-status', 'warning');
    await expect(canvas.getByTestId('pinned-digest')).toHaveTextContent('sha256:4b17e…a02');
    await expect(canvas.getByTestId('resolved-at')).toHaveTextContent('解析于 3 天前');
  },
};

/**
 * ⭐ 来源三档 —— play 钉住这一版补上的那一行。
 *
 * ⚠️ **「不知道」不能说成「没有」**：一张自定义镜像上的 `derivedFromDigest === null` 是
 * "平台没记下来"，⛔ 不许渲染成"它没有来源"，也⛔ 不许在前端替它算一个兼容性结论。
 */
export const LineageUnknown: Story = {
  args: {
    model: {
      ...customWarning,
      lineage: {
        kind: 'unknown',
        text: '来源未确定',
        note: '平台没有记下这张镜像是从哪一张预制镜像改来的。这不等于它没有来源，只是这一行没有这个记录（来源是注册那一刻判定并写下的）。',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('image-lineage');
    await expect(row).toHaveAttribute('data-lineage', 'unknown');
    await expect(row).toHaveTextContent('来源未确定');
    // 「不知道」不许被写成「没有」。
    await expect(row).toHaveTextContent('这不等于它没有来源');
    // ⛔ 前端不算兼容性：不许出现"能用/不能用/不兼容"这类结论。
    await expect(row).not.toHaveTextContent('不兼容');
    // emoji 前缀已换成 AlertTriangle：`unknown` 态才渲染这个图标（见 LineageDerived 的反例）。
    await expect(row.querySelector('svg.lucide-triangle-alert')).not.toBeNull();
  },
};

/** 来源已知：如实说它从哪一张锚点改来。 */
export const LineageDerived: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('image-lineage');
    await expect(row).toHaveAttribute('data-lineage', 'derived');
    await expect(row).toHaveTextContent('sha256:9f2ab…c31');
    // 反例：已知来源不该带告警图标（那个图标只在"不知道"时出现）。
    await expect(row.querySelector('svg.lucide-triangle-alert')).toBeNull();
  },
};

/** ⑥ 已禁用：卡片置灰 + [启用]（同一缓存派生 ⇒ 向导下拉里同时消失）。 */
export const Disabled: Story = {
  args: { model: { ...customWarning, isActive: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '启用' })).toBeInTheDocument();
    await expect(canvas.getByTestId('enable-state')).toHaveTextContent('已禁用');
    // MUTATION：把 `⚪`/`🟢` 拼回文案 ⇒ 下面这条锁不住的是"哪个状态"，
    // `data-active` 才是——这条在 emoji 写法与图标写法下都不该绿，除非真的按 isActive 切色。
    await expect(canvas.getByTestId('enable-state-icon')).toHaveAttribute('data-active', 'false');
  },
};

/**
 * ⑦ 🔄 上游有新版本 ——
 * play：角标用的是**信息色（蓝）而不是告警色（黄）**。当前镜像仍然完全可用，这是信息不是告警。
 */
export const UpstreamUpdate: Story = {
  args: { upstreamUpdate: { newDigestShort: 'sha256:8e05a…77f' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const badge = canvas.getByTestId('upstream-update-badge');
    await expect(badge).toHaveAttribute('data-tone', 'info');
    // 蓝 ≠ 黄：换成 amber/yellow 这条当场红。
    await expect(badge.className).toMatch(/sky|blue/);
    await expect(badge.className).not.toMatch(/amber|yellow/);
    await expect(canvas.getByRole('button', { name: '查看变更' })).toBeInTheDocument();
    await expect(badge.querySelector('svg.lucide-refresh-cw')).not.toBeNull();
  },
};

/**
 * ⑧ 以 digest 注册（无 tag）——
 * play：[检查更新] **置灰并给出理由**，不是隐藏（隐藏会让人以为这张卡少了个功能）。
 */
export const DigestRef: Story = {
  args: {
    model: {
      ...customWarning,
      refDisplay: `docker.io/myrepo/ml-agent@${FULL_DIGEST}`,
      refKind: 'digest',
      canCheckUpdate: false,
      checkUpdateDisabledReason: '该镜像以 digest 注册（无 tag），不存在上游漂移',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: '检查更新' });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', '该镜像以 digest 注册（无 tag），不存在上游漂移');
    await expect(canvas.getByTestId('digest-ref-note')).toBeInTheDocument();
  },
};

/**
 * ⑨ digest 未解析（F21-4 §6）——
 * play：显示「⚠️ 未解析」、**DOM 全文不含哨兵串 `sha256:unresolved`**、且 [检查更新] 置灰。
 * 不留白、不显示假哈希：留白读作"没有 digest"，假哈希读作"已钉死"，两句都是假话。
 */
export const DigestUnresolved: Story = {
  args: {
    model: {
      ...customWarning,
      digestState: 'unresolved',
      digestShort: undefined,
      digestFull: undefined,
      canCheckUpdate: false,
      checkUpdateDisabledReason: '这张镜像还没有确定版本，没有可比对的基准',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('digest-unresolved')).toHaveTextContent('版本未确定');
    await expect(canvasElement.textContent).not.toContain(SENTINEL);
    await expect(canvas.getByRole('button', { name: '检查更新' })).toBeDisabled();
    await expect(
      canvas.getByTestId('digest-unresolved').querySelector('svg.lucide-triangle-alert'),
    ).not.toBeNull();
  },
};
