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

export const ModelApiOk: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⚠️ 状态用 `StatusPill`（design/design-notes.md §2 八态对照表）：颜色/图标/文字三重
    // 线索，⛔ 不再是手写 emoji。
    await expect(canvas.getByTestId('connectivity-item-api.openai.com')).toHaveTextContent(
      '可达 · 351ms',
    );
  },
};

export const Pending: Story = {
  args: { pending: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('connectivity-item-api.openai.com');
    await expect(row.querySelector('[data-status="pending"]')).not.toBeNull();
    await expect(row).toHaveTextContent('检测中…');
  },
};

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
    // ⚠️ 连不上 ⇒ `fail`（红），⛔ 不是 `timeout`（紫）——两者是两个独立色相，见下面的
    //    `TimedOut`。
    await expect(row.querySelector('[data-status="fail"]')).not.toBeNull();
    await expect(row.querySelector('[data-status="timeout"]')).toBeNull();
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

/**
 * ⭐ **超时 ≠ 不可达**（P21-5 §9E）：两者必须是两个独立色相/图标，⛔ 不能长得一样——
 * 用户会把"网络抖了一下"和"这东西是坏的"当成同一件事去修，而修法完全不同。
 */
export const TimedOut: Story = {
  args: {
    row: {
      id: 'api.anthropic.com',
      target: 'api.anthropic.com',
      ok: false,
      modelApi: true,
      kindText: '模型 API',
      stateText: '超时未响应',
      timedOut: true,
      hint: '10 秒内没有完成握手，实测同一目标的握手会在 2.3s~10.2s 抖动。',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('connectivity-item-api.anthropic.com');
    await expect(row).toHaveAttribute('data-timed-out', 'true');
    await expect(row).toHaveTextContent('超时未响应');
    // ⛔ 否定断言：不许被压成「不可达」——那会让用户把两种严重度不同的情况当成一件事去修。
    await expect(row).not.toHaveTextContent('不可达');
    await expect(row.querySelector('[data-status="timeout"]')).not.toBeNull();
    await expect(row.querySelector('[data-status="fail"]')).toBeNull();
  },
};
