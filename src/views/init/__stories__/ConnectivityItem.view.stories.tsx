import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ConnectivityItemView } from '@/views/init/ConnectivityItem.view';

const meta: Meta<typeof ConnectivityItemView> = {
  title: 'Init/ConnectivityItem',
  component: ConnectivityItemView,
  parameters: { layout: 'padded' },
  args: {
    row: {
      id: 'api.openai.com',
      target: 'api.openai.com',
      ok: true,
      modelApi: true,
      kindText: '模型 API',
      stateText: '可达 · 351ms',
    },
  },
};
export default meta;

type Story = StoryObj<typeof ConnectivityItemView>;

export const ModelApiOk: Story = {};

export const Pending: Story = { args: { pending: true } };

/** ⭐ 镜像仓库不可达 ≠ 离线：这一行必须标出它属于「镜像仓库」那一类。 */
export const RegistryDown: Story = {
  args: {
    row: {
      id: 'ghcr.io',
      target: 'ghcr.io',
      ok: false,
      modelApi: false,
      kindText: '镜像仓库',
      stateText: '不可达',
      hint: '连接超时；如在内网请配置 HTTP_PROXY',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('connectivity-item-ghcr.io');
    // ⚠️ 两类分不开时，用户看到一条红的无从判断严重度：
    //    镜像仓库不通 = 拉不到新镜像；模型 API 不通 = Agent 根本跑不了。
    await expect(row).toHaveAttribute('data-model-api', 'false');
    await expect(canvas.getByTestId('connectivity-kind-ghcr.io')).toHaveTextContent('镜像仓库');
    // hint 整段渲染，不截断。
    await expect(row).toHaveTextContent('如在内网请配置 HTTP_PROXY');
  },
};

export const ModelApiDown: Story = {
  args: {
    row: {
      id: 'api.anthropic.com',
      target: 'api.anthropic.com',
      ok: false,
      modelApi: true,
      kindText: '模型 API',
      stateText: '不可达',
      hint: '连接超时（5s）',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('connectivity-item-api.anthropic.com')).toHaveAttribute(
      'data-model-api',
      'true',
    );
  },
};
