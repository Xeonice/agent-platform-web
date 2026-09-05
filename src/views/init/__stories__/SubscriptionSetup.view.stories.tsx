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
            '⚠️ 跳过后平台能进、项目能建，但在配好至少一个模型帐号之前无法发起任何任务 —— agent 需要它才能调用模型。',
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
    await expect(canvas.getByTestId('subscription-setup')).toHaveAttribute('data-ready', 'false');
    await expect(canvas.getByTestId('subscription-blocked')).toBeVisible();
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
  },
};

export const Expired: Story = {
  args: { model: model([{ ...CODEX, state: 'expired', maskedIdentifier: 'a***@gmail.com' }]) },
  play: async ({ canvasElement }) => {
    // ⚠️ 「已过期」与「未配置」的动作名不同：前者重新授权、后者首次配置。
    await expect(
      within(canvasElement).getByTestId('subscription-configure-codex'),
    ).toHaveTextContent('重新授权');
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
