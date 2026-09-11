import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { SandboxEnvStatusCardView } from '@/views/system/SandboxEnvStatusCard.view';
import type { SandboxEnvStatusCardModel } from '@/types/system';

function model(over: Partial<SandboxEnvStatusCardModel> = {}): SandboxEnvStatusCardModel {
  return {
    providers: [
      {
        id: 'aio',
        displayName: 'aio（容器运行时）',
        isDefault: true,
        level: 'ok',
        failureText: '最近 1h 失败率 0.5%（1/200）',
        capabilityText: '交互式终端 · 挂载工作区目录 · 状态变化推送 · 无人值守任务',
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

const meta: Meta<typeof SandboxEnvStatusCardView> = {
  title: 'System/SandboxEnvStatusCard',
  component: SandboxEnvStatusCardView,
  parameters: { layout: 'padded' },
  args: { model: model(), isError: false },
};
export default meta;

type Story = StoryObj<typeof SandboxEnvStatusCardView>;

export const Healthy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('sandbox-env-row-aio');
    await expect(row).toHaveTextContent('正常');
    await expect(row).toHaveTextContent('默认');
    // ⭐ 光一个 `aio` 摆在屏幕上，用户无从判断它是什么（P21-5 §3 原型带括号）。
    await expect(canvas.getByTestId('sandbox-env-name-aio')).toHaveTextContent('aio（容器运行时）');
    // ⛔ 能力位不许再把 camelCase 键名原样上屏。
    await expect(row).not.toHaveTextContent('spawnTty');
    await expect(row).toHaveTextContent('交互式终端');
  },
};

/** 5% —— 后端说 `healthy: true`（未越 10% 的 ❌ 线），产品要求它是 ⚠️。 */
export const FailureRateWarning: Story = {
  args: {
    model: model({
      providers: [
        {
          // ⚠️ 第三方 provider：开放注册表 ⇒ **原样用 id**，⛔ 不编一个括号说明。
          id: 'custom-xx',
          displayName: 'custom-xx',
          isDefault: false,
          level: 'warning',
          failureText: '最近 1h 失败率 5%（2/40）',
          capabilityText: '交互式终端 · 无人值守任务',
        },
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('sandbox-env-row-custom-xx');
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
          displayName: 'custom-xx',
          isDefault: false,
          level: 'error',
          failureText: '最近 1h 失败率 22%（11/50）',
          capabilityText: '交互式终端',
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
          displayName: 'boxlite（微 VM）',
          isDefault: false,
          level: 'no-sample',
          failureText: '无样本（最近 1h 没有沙箱创建记录）',
          capabilityText: '交互式终端 · 挂载工作区目录 · 状态变化推送 · 无人值守任务',
        },
      ],
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('sandbox-env-row-boxlite');
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
    await expect(canvas.getByRole('alert')).toHaveTextContent('沙箱环境概览读取失败');
    // 空白 ≠ 没有 provider。
    await expect(canvas.queryByTestId('sandbox-env-row-aio')).not.toBeInTheDocument();
  },
};
