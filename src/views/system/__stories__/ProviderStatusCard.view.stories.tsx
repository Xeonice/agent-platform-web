import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ProviderStatusCardView } from '@/views/system/ProviderStatusCard.view';
import type { ProviderStatusCardModel } from '@/types/system';

function model(over: Partial<ProviderStatusCardModel> = {}): ProviderStatusCardModel {
  return {
    providers: [
      {
        id: 'aio',
        isDefault: true,
        level: 'ok',
        failureText: '最近 1h 失败率 0.5%（1/200）',
        capabilityText: 'spawnTty · volumeMount · watchEvents · headlessTask',
      },
    ],
    runtimes: [
      {
        id: 'codex',
        displayName: 'Codex',
        vendor: 'OpenAI',
        credentialConfigured: true,
        credentialText: '凭证已配置',
        authMethodsText: 'oauth-device · api-key',
      },
    ],
    imageSpecs: [{ id: 'oci', isDefault: true }],
    windowText: '最近 1 小时',
    ...over,
  };
}

const meta: Meta<typeof ProviderStatusCardView> = {
  title: 'System/ProviderStatusCard',
  component: ProviderStatusCardView,
  parameters: { layout: 'padded' },
  args: { model: model(), isError: false },
};
export default meta;

type Story = StoryObj<typeof ProviderStatusCardView>;

export const Healthy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('provider-row-aio')).toHaveTextContent('正常');
    await expect(canvas.getByTestId('provider-row-aio')).toHaveTextContent('默认');
  },
};

/** 5% —— 后端说 `healthy: true`（未越 10% 的 ❌ 线），产品要求它是 ⚠️。 */
export const FailureRateWarning: Story = {
  args: {
    model: model({
      providers: [
        {
          id: 'custom-xx',
          isDefault: false,
          level: 'warning',
          failureText: '最近 1h 失败率 5%（2/40）',
          capabilityText: 'spawnTty · headlessTask',
        },
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('provider-row-custom-xx');
    await expect(row).toHaveTextContent('失败率偏高');
    // 否定断言：⚠️ 与 ✅ 不许同时出现（把 healthy 直接当档次时这条会红）。
    await expect(row).not.toHaveTextContent('正常');
  },
};

export const FailureRateError: Story = {
  args: {
    model: model({
      providers: [
        {
          id: 'custom-xx',
          isDefault: false,
          level: 'error',
          failureText: '最近 1h 失败率 22%（11/50）',
          capabilityText: 'spawnTty',
        },
      ],
    }),
  },
};

/** ⭐ 无样本：**不是** 0%、也不是 ✅ —— 这一小时没人用过它，没有任何结论可下。 */
export const NoSample: Story = {
  args: {
    model: model({
      providers: [
        {
          id: 'boxlite',
          isDefault: false,
          level: 'no-sample',
          failureText: '无样本（最近 1h 没有沙箱创建记录）',
          capabilityText: 'spawnTty · volumeMount · watchEvents · headlessTask',
        },
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('provider-row-boxlite');
    await expect(row).toHaveTextContent('无样本');
    // ⚠️ 否定断言是关键：`?? 0` 之后这一行会平静地显示「失败率 0% 正常」，
    //    上面那条肯定断言换成 getByText('0%') 也照样绿。
    await expect(row).not.toHaveTextContent('0%');
    await expect(row).not.toHaveTextContent('正常');
  },
};

export const RuntimeCredentialMissing: Story = {
  args: {
    model: model({
      runtimes: [
        {
          id: 'claude-code',
          displayName: 'Claude Code',
          vendor: 'Anthropic',
          credentialConfigured: false,
          credentialText: '凭证未配置',
          authMethodsText: 'setup-token · api-key',
        },
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('runtime-row-claude-code')).toHaveTextContent('凭证未配置');
  },
};

export const LoadFailed: Story = {
  args: { model: null, isError: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('Provider 概览读取失败');
    // 空白 ≠ 没有 provider。
    await expect(canvas.queryByTestId('provider-row-aio')).not.toBeInTheDocument();
  },
};
