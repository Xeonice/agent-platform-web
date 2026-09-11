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
      label: '容器服务可达',
      status: 'ok',
      headline: '容器服务可达',
      detailText: '/var/run/docker.sock，142ms · Docker/27.3.1 (linux)。',
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
    // ⚠️ 默认只看到一句结论：证据在展开层里。
    await expect(canvas.getByTestId('diagnostic-headline-container-runtime')).toHaveTextContent(
      '容器服务可达',
    );
    await expect(canvas.queryByTestId('diagnostic-detail-container-runtime')).toBeNull();
  },
};

export const Pending: Story = {
  args: { item: { id: 'ws-loopback', label: '实时推送自检' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('检查中…')).toBeInTheDocument();
    // 没有第二层就**不给展开按钮** —— 一个点开是空的按钮比没有按钮更糟。
    await expect(canvas.queryByTestId('diagnostic-toggle-ws-loopback')).toBeNull();
  },
};

/**
 * ⭐ **散文归散文，命令归命令**（2026-09-11 拆的那两个字段）。
 *
 * ⛔ 上一版把整个 `hint` 塞进 `<code>` 等宽框 + [复制]，而后端的 hint 早就演化成散文了
 * （「重跑一次看稳不稳定」）—— **一段散文顶着一个复制按钮**，复制下来也没地方粘。
 */
export const Warning: Story = {
  args: {
    item: {
      id: 'outbound-network',
      label: '外网连通（模型 API / 镜像仓库）',
      status: 'warn',
      headline: '拉不到新镜像，Agent 仍可用',
      detailText: 'ghcr.io 未在超时时限内应答。模型 API 正常，Agent 可用。',
      nextStep: '重跑一次看它稳不稳定：偶发多半只是慢；每次都这样就在系统设置里填代理后重试。',
      durationText: '7s',
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('diagnostic-toggle-outbound-network'));
    // ⛔ 只有散文、没有命令 ⇒ **一个 [复制] 按钮都不该出现**。
    await expect(canvas.queryByRole('button', { name: '复制' })).toBeNull();
    await expect(canvas.getByTestId('diagnostic-next-outbound-network')).toHaveTextContent(
      '重跑一次',
    );
    await expect(args.onCopyHint).not.toHaveBeenCalled();
  },
};

/** ⭐ §9B：端口号 · 进程名与 pid · 平台原本要用它做什么，**三样一个都不许丢**。 */
export const PortConflictFail: Story = {
  args: {
    item: {
      id: 'port-conflict',
      label: '端口占用',
      status: 'fail',
      headline: '端口 3000 被占用，平台起不来',
      detailText:
        '端口 3000（平台 HTTP/WS 服务（REST · /events · /terminal · /tasks 同一端口））被 com.docke (pid 41235) 占用。',
      nextStep: '先确认它是什么，确实该让路就停掉它；否则给平台换一个端口后重启平台。',
      command: 'lsof -nP -iTCP:3000 -sTCP:LISTEN',
      durationText: '312ms',
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('diagnostic-item-port-conflict');
    // 第一眼看到的是结论 + 挡不挡我干活。
    await expect(row).toHaveTextContent('端口 3000 被占用，平台起不来');

    await userEvent.click(canvas.getByTestId('diagnostic-toggle-port-conflict'));
    // ⚠️ 证据一个字都不许丢：用户下一步要做的是**找出占它的东西**。
    await expect(row).toHaveTextContent('com.docke');
    await expect(row).toHaveTextContent('pid 41235');
    await expect(row).toHaveTextContent('平台 HTTP/WS 服务');

    // 只有真命令配等宽 + [复制]，且复制的是**命令原文**。
    await userEvent.click(canvas.getByRole('button', { name: '复制' }));
    await expect(args.onCopyHint).toHaveBeenCalledWith('lsof -nP -iTCP:3000 -sTCP:LISTEN');
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
      stepText:
        '前 4 步已通过，已到第 5 步（共 5 步） · 有没有下载到本机（没下载只影响首个任务的耗时）',
      headline: '镜像还没下载到本机',
      detailText:
        '镜像本身没问题，只是这台机器上还没有它的副本（镜像压缩后约 0.3GB，通常十几秒到一分钟）。',
      nextStep: '不需要做任何事，第一个任务会自动下载。',
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
    // ⭐ 序号自带上下文：「前 4 步已通过」+「共 5 步」。
    const step = canvas.getByTestId('diagnostic-step-preset-image');
    await expect(step).toHaveTextContent('前 4 步已通过');
    await expect(step).toHaveTextContent('共 5 步');
    await expect(step).not.toHaveTextContent('卡在');
  },
};

/** §9A 第 3 步：来源不对有**自己的**步骤说明与码，不与其余四步共用一句。 */
export const PresetImageLineageFail: Story = {
  args: {
    item: {
      id: 'preset-image',
      label: '预制镜像就绪',
      status: 'fail',
      step: 'lineage',
      stepText: '前 2 步已通过，卡在第 3 步（共 5 步） · 来源对不对（是不是平台自己构建的那张）',
      errorCode: 'PRESET_IMAGE_NOT_PLATFORM_BUILT',
      headline: '这张镜像来源不对，用不了',
      detailText:
        "'ghcr.io/agent-infra/sandbox:latest' 是上游镜像，不是平台自己构建的那张 —— 手动把它加进来同样会被拒。",
      nextStep: '用平台的构建脚本重新构建再推上去。',
      command: 'bash scripts/build-sandbox-image.sh',
      durationText: '88ms',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⭐ 「卡在第 3 步（共 5 步）」—— 一个孤零零的序号回答不了「前面过了没有」。
    const step = canvas.getByTestId('diagnostic-step-preset-image');
    await expect(step).toHaveTextContent('前 2 步已通过，卡在第 3 步（共 5 步）');
    // ⛔ 「血统」是内部词，上屏说「来源」。
    await expect(step).not.toHaveTextContent('血统');

    await userEvent.click(canvas.getByTestId('diagnostic-toggle-preset-image'));
    await expect(canvas.getByTestId('diagnostic-code-preset-image')).toHaveTextContent(
      'PRESET_IMAGE_NOT_PLATFORM_BUILT',
    );
  },
};

/** `timeout` 与 `fail` 分开：「答不上来」不是「这一项是坏的」。 */
export const TimedOut: Story = {
  args: {
    item: {
      id: 'outbound-network',
      label: '外网连通（模型 API / 镜像仓库）',
      status: 'timeout',
      headline: '10 秒内没有结果',
      detailText: '这一项这次没有结论，其余项不受影响。',
      nextStep: '看这一项依赖的东西是卡住了还是在报错；再跑一次诊断，看它是不是每次都超时。',
      durationText: '10s',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('diagnostic-item-outbound-network');
    await expect(row).toHaveTextContent('未得出结论');
    await expect(row).not.toHaveTextContent('失败');
  },
};

/**
 * ⛔ **markdown 字面量上屏的回归**（本轮 P0）。
 *
 * 全链路**没有 markdown 渲染器**，所以后端一旦写了 `**…**`，用户读到的就是带星号的
 * 源代码。这条故事把一段带星号的文案原样喂进来，断言屏幕上**看得见那两个星号** ——
 * 也就是说：这里不是"渲染不出来"，而是"根本不该有"。⇒ 后端每一项检查的 spec 里都有
 * 一条「上屏文案不许含 `**`」的断言，那才是这条纪律真正的守卫位置。
 */
export const MarkdownIsNotRendered: Story = {
  args: {
    item: {
      id: 'data-root-fs',
      label: '数据目录文件系统',
      status: 'warn',
      headline: '秒级复制用不了，更费磁盘',
      detailText: '这里如果写 **加粗**，用户读到的就是这五个字符本身。',
      durationText: '9ms',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('diagnostic-toggle-data-root-fs'));
    await expect(canvas.getByTestId('diagnostic-detail-data-root-fs')).toHaveTextContent(
      '**加粗**',
    );
  },
};
