import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { RuntimeCredentialsSectionView } from '@/views/settings/RuntimeCredentialsSection.view';
import type { RuntimeCredentialCardModel } from '@/types/runtimeCredential';

const noop = (): void => undefined;
const panelNone = (): undefined => undefined;

const codex: RuntimeCredentialCardModel = {
  runtimeId: 'codex',
  displayName: 'Codex',
  vendor: 'OpenAI',
  status: 'active',
  hasAnyCredential: true,
  rows: [
    {
      mode: 'account',
      method: 'oauth-device',
      label: '帐号登录',
      configured: true,
      active: true,
      maskedIdentifier: 'a***@gmail.com',
      credentialId: 'rc-1',
      expiryLabel: '剩 30 天',
      expiryState: 'ok',
    },
    {
      mode: 'api-key',
      method: 'api-key',
      label: 'API Key',
      configured: false,
      active: false,
      expiryState: 'noExpiry',
    },
  ],
};

const meta: Meta<typeof RuntimeCredentialsSectionView> = {
  title: 'Settings/RuntimeCredentialsSection',
  component: RuntimeCredentialsSectionView,
  parameters: { layout: 'padded' },
  args: {
    cards: [codex],
    search: '',
    onSearch: noop,
    onRetryLoad: noop,
    panelFor: panelNone,
    onSwitch: noop,
    onNeedSetup: noop,
    onReauth: noop,
    onAddKey: noop,
    onRevoke: noop,
  },
};
export default meta;

type Story = StoryObj<typeof RuntimeCredentialsSectionView>;

export const Default: Story = {};

export const Loading: Story = { args: { loading: true } };

/** 搜了、没命中。 */
export const NoMatch: Story = {
  args: { cards: [], search: 'zzz' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('没有匹配的 Agent。')).toBeVisible();
  },
};

/** 没搜、注册表本来就是空的 —— 与「没有匹配」不是一句话。 */
export const EmptyRegistry: Story = {
  args: { cards: [], search: '' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('这台机器上还没有可用的 Agent。')).toBeVisible();
  },
};

/**
 * ⛔ **查不动**：`useRuntimes` 的 isError 此前全仓无人读，接口挂了照样渲染「没有匹配」，
 * 而用户根本没搜索过。这一条钉住「加载失败」自成一态且带 [重试]。
 */
export const LoadError: Story = {
  args: { cards: [], search: '', loadError: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('runtime-load-error')).toBeVisible();
    await expect(canvas.getByRole('button', { name: '重试' })).toBeVisible();
    await expect(canvas.queryByText(/没有匹配的 Agent/)).toBeNull();
  },
};
