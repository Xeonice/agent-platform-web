import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DiagnosticItemView } from '@/views/system/DiagnosticItem.view';

const meta: Meta<typeof DiagnosticItemView> = {
  title: 'System/DiagnosticItem',
  component: DiagnosticItemView,
  parameters: { layout: 'padded' },
  args: {
    item: {
      id: 'container-runtime',
      label: '容器运行时可达',
      status: 'ok',
      summary: 'aio：docker socket 可达（/var/run/docker.sock），版本 27.3.1',
      durationText: '142ms',
    },
    onCopyHint: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof DiagnosticItemView>;

export const Ok: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('diagnostic-item-container-runtime')).toHaveAttribute(
      'data-status',
      'ok',
    );
  },
};

export const Pending: Story = {
  args: { item: { id: 'ws-loopback', label: 'WS 回环' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('检查中…')).toBeInTheDocument();
  },
};

export const Warning: Story = {
  args: {
    item: {
      id: 'outbound-network',
      label: '外网连通（模型 API / 镜像仓库）',
      status: 'warn',
      summary: 'api.openai.com 可达（182ms）；ghcr.io 连接超时',
      hint: 'HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 重启平台',
      durationText: '5s',
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '复制' }));
    // 复制的是**命令原文**，不是被截断/加了引号的版本。
    await expect(args.onCopyHint).toHaveBeenCalledWith(
      'HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 重启平台',
    );
  },
};

/** ⭐ §9B：端口号 · 进程名与 pid · 平台原本要用它做什么，**三样都要看得见**。 */
export const PortConflictFail: Story = {
  args: {
    item: {
      id: 'port-conflict',
      label: '端口占用',
      status: 'fail',
      summary:
        '端口 3000（平台 HTTP/WS 服务（REST · /events · /terminal · /tasks 同一端口））被 com.docke (pid 41235) 占用',
      hint: '先确认它是什么：lsof -nP -iTCP:3000 -sTCP:LISTEN；确实该让路就停掉它，否则给平台换一个端口：PORT=<其它端口> 重启平台',
      durationText: '312ms',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('diagnostic-item-port-conflict');
    // ⚠️ 只显示「被占用」等于把诊断最有用的部分丢掉：用户下一步要做的是**找出占它的东西**。
    await expect(row).toHaveTextContent('3000');
    await expect(row).toHaveTextContent('com.docke');
    await expect(row).toHaveTextContent('pid 41235');
    await expect(row).toHaveTextContent('平台 HTTP/WS 服务');
  },
};

/** ⭐ §9A 第 5 步：`info` 渲染 ℹ️「提示」—— **不是** ⚠️「警告」。 */
export const PresetImageStagedInfo: Story = {
  args: {
    item: {
      id: 'preset-image',
      label: '预制镜像就绪',
      status: 'info',
      step: 'staged',
      stepText: '检查链第 5 步 · 本机铺开（未铺开只影响首个任务的耗时）',
      summary:
        '预制镜像已就绪，但尚未在本机铺开 —— 首个任务需要数分钟准备镜像（13GB 镜像实测冷启动约 190 秒），之后每次 3–4 秒',
      hint: '不需要任何操作：第一个任务会自动拉取并铺开',
      durationText: '431ms',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('diagnostic-item-preset-image');
    await expect(row).toHaveAttribute('data-status', 'info');
    await expect(row).toHaveTextContent('提示');
    // ⚠️ 否定断言是关键：渲染成「警告」会让用户去修一个不需要修的东西，
    //    而他能想到的"修法"是删了重推 —— 那会让情况更糟。
    await expect(row).not.toHaveTextContent('警告');
    await expect(row).not.toHaveTextContent('失败');
    await expect(canvas.getByTestId('diagnostic-step-preset-image')).toHaveTextContent('第 5 步');
  },
};

/** §9A 第 3 步：血统失败有**自己的**步骤说明与码，不与其余四步共用一句。 */
export const PresetImageLineageFail: Story = {
  args: {
    item: {
      id: 'preset-image',
      label: '预制镜像就绪',
      status: 'fail',
      step: 'lineage',
      stepText: '检查链第 3 步 · 血统（是不是平台自建的那张，不是上游镜像）',
      errorCode: 'PRESET_IMAGE_NOT_PLATFORM_BUILT',
      summary:
        "'ghcr.io/agent-infra/sandbox:latest' 是上游镜像，不是平台自建的那张 —— 注册也会被拒",
      hint: 'bash scripts/build-sandbox-image.sh 然后推到你的 registry',
      durationText: '88ms',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('diagnostic-code-preset-image')).toHaveTextContent(
      'PRESET_IMAGE_NOT_PLATFORM_BUILT',
    );
    await expect(canvas.getByTestId('diagnostic-step-preset-image')).toHaveTextContent('第 3 步');
  },
};

/** `timeout` 与 `fail` 分开：「答不上来」不是「这一项是坏的」。 */
export const TimedOut: Story = {
  args: {
    item: {
      id: 'outbound-network',
      label: '外网连通（模型 API / 镜像仓库）',
      status: 'timeout',
      summary: '外网连通（模型 API / 镜像仓库）：5 秒内没有结果 —— 这一项没有结论，其余项不受影响',
      durationText: '5s',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('diagnostic-item-outbound-network');
    await expect(row).toHaveTextContent('超时未得出结论');
    await expect(row).not.toHaveTextContent('失败');
  },
};
