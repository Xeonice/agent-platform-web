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

/** ⑥ 已禁用：卡片置灰 + [启用]（同一缓存派生 ⇒ 向导下拉里同时消失）。 */
export const Disabled: Story = {
  args: { model: { ...customWarning, isActive: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '启用' })).toBeInTheDocument();
    await expect(canvas.getByTestId('enable-state')).toHaveTextContent('已禁用');
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
      checkUpdateDisabledReason: '该镜像尚未解析出 digest，没有可比对的基准',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('digest-unresolved')).toHaveTextContent('未解析');
    await expect(canvasElement.textContent).not.toContain(SENTINEL);
    await expect(canvas.getByRole('button', { name: '检查更新' })).toBeDisabled();
  },
};
