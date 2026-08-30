import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { BannerStackView } from '@/views/banner/BannerStack.view';
import type { GlobalBannerModel } from '@/types/banner';

const OFFLINE: GlobalBannerModel = {
  id: 'offline',
  severity: 'blocking',
  title: '离线模式：Agent 不可用',
  description:
    '当前为离线环境，Agent 将不可用 —— codex / claude code 必须能访问各自的模型 API，这是物理约束，不是配置问题。' +
    '平台其余功能（项目管理、凭证与镜像配置、系统诊断）照常可用。（上次检测：2026-08-29 16:11:34（22 小时前））',
  actionLabel: '重新检测',
};

const UNKNOWN: GlobalBannerModel = {
  id: 'platform-state-unknown',
  severity: 'blocking',
  title: '无法确认平台状态',
  description:
    '读取平台初始化状态失败（请求失败（HTTP 500））。这多半是后端没起来或不可达 —— ' +
    '在它恢复之前，「Agent 是否可用」无法判定：既不表示网络正常，也不表示离线。',
  actionLabel: '查看系统状态',
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
    await expect(banner).toHaveAttribute('data-severity', 'blocking');
    // ⚠️ 必须说清"哪一半还好着"：只说 Agent 不可用会让用户以为整台平台废了。
    await expect(banner).toHaveTextContent('照常可用');
    await userEvent.click(canvas.getByTestId('banner-action-offline'));
    await expect(args.onAction).toHaveBeenCalledWith('offline');
  },
};

/**
 * ⭐ 关闭是**显式动作**：🔴 阻断类不自动收起（07 §8.4）。
 * 这条 play 顺带守住"关闭按钮有可访问名"——只有一个「关闭」字的按钮在多条并存时无法区分。
 */
export const DismissIsExplicit: Story = {
  args: { model: { banners: [OFFLINE] } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: '关闭「离线模式：Agent 不可用」提示' }),
    );
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
    await expect(banner).toHaveTextContent('后端没起来');
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

/** ⭐ 一条都没有 ⇒ **整块不渲染**（连空容器都没有，否则每页顶上多一条线）。 */
export const Empty: Story = {
  args: { model: { banners: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId('banner-stack')).toBeNull();
  },
};
