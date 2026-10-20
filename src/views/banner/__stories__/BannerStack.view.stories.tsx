import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { BannerStackView } from '@/views/banner/BannerStack.view';
import type { GlobalBannerModel } from '@/types/banner';

const OFFLINE: GlobalBannerModel = {
  id: 'offline',
  severity: 'warning',
  title: '联网检查未通过',
  description:
    '本次探测的模型 API 目标均未连通。任务实际连通性以其配置和执行结果为准。' +
    '上次检测：2026-08-29 16:11:34（22 小时前）（上次检查记录）',
  actionLabel: '重新检测',
};

const UNKNOWN: GlobalBannerModel = {
  id: 'platform-state-unknown',
  severity: 'blocking',
  title: '无法确认平台状态',
  description:
    '读取平台初始化状态失败（请求失败（HTTP 500））。当前平台状态待确认；已有联网检查记录只反映其探测目标。',
  actionLabel: '查看系统状态',
};

/** ⚠️ 治理类：唯一的生产方是 `lib/automation/automationAttention.ts`（定时规则自动停用/被放慢）。 */
const AUTOMATION_ATTENTION: GlobalBannerModel = {
  id: 'automation-needs-attention',
  severity: 'warning',
  title: '有 2 条定时规则已自动停用',
  description:
    '2 条连着失败 10 次后已经不再触发，要重新开启才会继续跑。' +
    '定时任务停了不会有别的提示，这里是唯一会主动告诉你的地方。',
  actionLabel: '查看这些规则',
};

const meta: Meta<typeof BannerStackView> = {
  title: 'Banner/BannerStack',
  component: BannerStackView,
  parameters: { layout: 'fullscreen' },
  args: { onAction: fn(), onDismiss: fn() },
};
export default meta;

type Story = StoryObj<typeof BannerStackView>;

export const Offline: Story = {
  args: { model: { banners: [OFFLINE] } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const banner = canvas.getByTestId('banner-offline');
    await expect(banner).toHaveAttribute('data-severity', 'warning');
    // 治理级使用 lucide AlertTriangle，装饰性
    // （`aria-hidden`）——等级信息仍由 `sr-only` 的文字承担，不靠图标形状区分。
    await expect(banner.querySelector('.lucide-triangle-alert')).not.toBeNull();
    await expect(banner.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    // 目标检查不推断全部任务或 Agent 的实际能力。
    await expect(banner).toHaveTextContent('任务实际连通性以其配置和执行结果为准');
    await userEvent.click(canvas.getByTestId('banner-action-offline'));
    await expect(args.onAction).toHaveBeenCalledWith('offline');
  },
};

/**
 * 关闭是显式动作：联网检查记录沿治理提示的当天关闭语义。
 * 这条 play 顺带守住"关闭按钮有可访问名"——只有一个「关闭」字的按钮在多条并存时无法区分。
 */
export const DismissIsExplicit: Story = {
  args: { model: { banners: [OFFLINE] } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '今天不再提示「联网检查未通过」' }));
    await expect(args.onDismiss).toHaveBeenCalledWith('offline');
  },
};

/**
 * ⭐ 「读不到平台状态」与「离线」是**两条不同的横幅、两句不同的话**
 * （`lib/system/globalBanner.ts` ①）。这条 story 的否定断言就是那条纪律：
 * 后端没起来时**不许**出现"离线"两个字，那会把用户送去查一个没有问题的网络。
 */
export const PlatformStateUnknown: Story = {
  args: { model: { banners: [UNKNOWN] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const banner = canvas.getByTestId('banner-platform-state-unknown');
    await expect(banner).toHaveTextContent('当前平台状态待确认');
    await expect(banner).not.toHaveTextContent('离线模式');
    await expect(canvas.queryByTestId('banner-offline')).toBeNull();
  },
};

/** 两条同时命中：「状态未知」排在上面——它否定的是下面那条作不作数。 */
export const Stacked: Story = {
  args: { model: { banners: [UNKNOWN, OFFLINE] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alerts = canvas.getAllByRole('alert');
    await expect(alerts).toHaveLength(2);
    await expect(alerts[0]).toHaveAttribute('data-testid', 'banner-platform-state-unknown');
  },
};

/** ⚠️ 治理类单独展示：琥珀色三件套（边框/底色/文字），与阻断类的红三件套明确区分。 */
export const Governance: Story = {
  args: { model: { banners: [AUTOMATION_ATTENTION] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const banner = canvas.getByTestId('banner-automation-needs-attention');
    await expect(banner).toHaveAttribute('data-severity', 'warning');
    await expect(within(banner).getByText('治理')).toBeInTheDocument();
    // ⭐ ⚠️ 换成了 lucide `AlertTriangle`（渲染 class 是 `lucide-triangle-alert`，
    // 不是看名字猜的 `lucide-alert-triangle`）——与阻断类的 `lucide-octagon-alert`
    // 是两个不同的图标，不只是换了颜色。
    await expect(banner.querySelector('.lucide-triangle-alert')).not.toBeNull();
    await expect(banner.querySelector('.lucide-octagon-alert')).toBeNull();
    // 治理提示与阻断提示使用不同的语义颜色。
    await expect(banner.className).toContain('v2-status-warn-subtle-bg');
  },
};

/**
 * 同时存在阻断与治理提示时，验证排序和视觉分层；单条故事无法覆盖优先级。
 * 修改 BANNER_RANK 或共用两档颜色应使排序或样式断言失败。
 */
export const BlockingOutranksGovernance: Story = {
  args: { model: { banners: [UNKNOWN, OFFLINE, AUTOMATION_ATTENTION] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alerts = canvas.getAllByRole('alert');
    await expect(alerts).toHaveLength(2);
    await userEvent.click(canvas.getByTestId('banner-stack-more'));
    const expandedAlerts = canvas.getAllByRole('alert');
    await expect(expandedAlerts).toHaveLength(3);
    // 状态未知在前；联网快照与其余治理提示保持出现顺序。
    await expect(expandedAlerts.map((a) => a.getAttribute('data-testid'))).toEqual([
      'banner-platform-state-unknown',
      'banner-offline',
      'banner-automation-needs-attention',
    ]);
    // 颜色层面同一件事：阻断类用红色三件套，治理类不与它共用。
    await expect(expandedAlerts[0]?.className).toContain('v2-status-fail-subtle-bg');
    await expect(expandedAlerts[1]?.className).toContain('v2-status-warn-subtle-bg');
    await expect(expandedAlerts[2]?.className).toContain('v2-status-warn-subtle-bg');
  },
};

/** ⭐ 一条都没有 ⇒ **整块不渲染**（连空容器都没有，否则每页顶上多一条线）。 */
export const Empty: Story = {
  args: { model: { banners: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId('banner-stack')).toBeNull();
  },
};
