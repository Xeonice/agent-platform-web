import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { SubscriptionSetupView } from '@/views/init/SubscriptionSetup.view';
import type { SubscriptionRuntimeModel, SubscriptionStepModel } from '@/types/init';

const CODEX: SubscriptionRuntimeModel = {
  id: 'codex',
  displayName: 'ChatGPT（Codex）',
  state: 'none',
  methods: ['oauth-device', 'api-key'],
};
const CLAUDE: SubscriptionRuntimeModel = {
  id: 'claude-code',
  displayName: 'Claude Code',
  state: 'none',
  methods: ['setup-token', 'api-key'],
};

function model(runtimes: SubscriptionRuntimeModel[]): SubscriptionStepModel {
  const ready = runtimes.some((r) => r.state === 'ready');
  return {
    runtimes,
    ready,
    ...(ready
      ? {}
      : {
          blockedText:
            '跳过后平台能进、项目能建，但在配好至少一个模型帐号之前无法发起任何任务 —— agent 需要它才能调用模型。',
        }),
  };
}

const meta: Meta<typeof SubscriptionSetupView> = {
  title: 'Init/SubscriptionSetup',
  component: SubscriptionSetupView,
  parameters: { layout: 'padded' },
  args: {
    model: model([CODEX, CLAUDE]),
    onExpand: fn(),
    onCollapse: fn(),
    renderAuthPanel: () => <div data-testid="auth-panel-slot">（鉴权面板）</div>,
  },
};
export default meta;
type Story = StoryObj<typeof SubscriptionSetupView>;

export const NoneConfigured: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const section = canvas.getByTestId('subscription-setup');
    await expect(section).toHaveAttribute('data-ready', 'false');
    await expect(canvas.getByTestId('subscription-blocked')).toBeVisible();

    /**
     * ⛔ **「不必两个都配」把 Agent 的数量写死成 2**（2026-09 修）。Agent 是**开放
     * 注册表**（04 §3）—— 装了第三方 Agent 的机器上这句话当场变成假话。
     * MUTATION：改回「不必两个都配」⇒ 本条红。
     */
    await expect(section).not.toHaveTextContent('不必两个都配');
    await expect(section).toHaveTextContent('不用全部配');
    // ⚠️ 「配好任意一个就能开始」不许省：判据本来就是"至少一个"。
    await expect(section).toHaveTextContent('配好任意一个就能开始');
    // MUTATION：把 `<AlertTriangle>` 换回 ⚠️ 字符或换成另一个图标 ⇒ 这条先红。
    await expect(
      canvas.getByTestId('subscription-blocked').querySelector('svg.lucide-triangle-alert'),
    ).not.toBeNull();
    // 两个 runtime 都未配置 ⇒ 都渲染中性的 `Circle`（未配置不是警告，不该用告警图标）。
    await expect(
      canvas.getByTestId('subscription-runtime-icon-codex').classList.contains('lucide-circle'),
    ).toBe(true);
  },
};

export const OneConfigured: Story = {
  args: {
    model: model([{ ...CODEX, state: 'ready', maskedIdentifier: 'a***@gmail.com' }, CLAUDE]),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⛔ 判据是「至少一个可用」：一台只跑 codex 的机器不该被 claude-code 的空凭证挡住。
    await expect(canvas.getByTestId('subscription-setup')).toHaveAttribute('data-ready', 'true');
    await expect(canvas.queryByTestId('subscription-blocked')).toBeNull();
    // ⛔ 已配好的那行没有下一步 —— 给动作按钮会让人以为还差点什么。
    await expect(canvas.queryByTestId('subscription-configure-codex')).toBeNull();
    await expect(canvas.getByTestId('subscription-configure-claude-code')).toBeVisible();
    await expect(
      canvas.getByTestId('subscription-runtime-icon-codex').classList.contains('lucide-check'),
    ).toBe(true);
  },
};

export const Expired: Story = {
  args: { model: model([{ ...CODEX, state: 'expired', maskedIdentifier: 'a***@gmail.com' }]) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⚠️ 「已过期」与「未配置」的动作名不同：前者重新授权、后者首次配置。
    await expect(canvas.getByTestId('subscription-configure-codex')).toHaveTextContent('重新授权');
    await expect(
      canvas
        .getByTestId('subscription-runtime-icon-codex')
        .classList.contains('lucide-triangle-alert'),
    ).toBe(true);
  },
};

export const PanelExpanded: Story = {
  args: { expandedRuntimeId: 'codex' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('auth-panel-slot')).toBeVisible();
  },
};

export const NoRuntimeRegistered: Story = {
  args: { model: model([]) },
  play: async ({ canvasElement }) => {
    // ⛔ 空 registry 要如实说，不渲染一个空列表让人以为在加载。
    await expect(within(canvasElement).getByTestId('subscription-no-runtime')).toBeVisible();
  },
};
