import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DiagnosticsCardView } from '@/views/system/DiagnosticsCard.view';
import type { DiagnosticItemModel, DiagnosticsCardModel } from '@/types/system';

const EIGHT: DiagnosticItemModel[] = [
  { id: 'container-runtime', label: '容器运行时可达' },
  { id: 'dev-kvm', label: '/dev/kvm 可用（boxlite 微 VM）' },
  { id: 'disk-space', label: '磁盘余量（DATA_ROOT）' },
  { id: 'port-conflict', label: '端口占用' },
  { id: 'outbound-network', label: '外网连通（模型 API / 镜像仓库）' },
  { id: 'ws-loopback', label: 'WS 回环' },
  { id: 'data-root-fs', label: 'DATA_ROOT 文件系统' },
  { id: 'preset-image', label: '预制镜像就绪' },
];

function withResult(id: DiagnosticItemModel['id'], patch: Partial<DiagnosticItemModel>) {
  return EIGHT.map((i) => (i.id === id ? { ...i, ...patch } : i));
}

const meta: Meta<typeof DiagnosticsCardView> = {
  title: 'System/DiagnosticsCard',
  component: DiagnosticsCardView,
  parameters: { layout: 'padded' },
  args: {
    model: { phase: 'idle', items: [] } satisfies DiagnosticsCardModel,
    isDiagnosing: false,
    schemaMismatch: null,
    onDiagnose: fn(),
    onExportLogs: fn(),
    onCopyHint: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof DiagnosticsCardView>;

/** 还没跑过：**不画八行灰条** —— 那时服务端还没说过清单。 */
export const NeverRun: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/尚未运行/)).toBeInTheDocument();
    await expect(canvas.queryByTestId('diagnostic-item-container-runtime')).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: '重新诊断' }));
    await expect(args.onDiagnose).toHaveBeenCalledTimes(1);
  },
};

/** 运行中：已返回项立即定格，未返回项 ⏳ —— 而**不是**整块 loading。 */
export const RunningPartial: Story = {
  args: {
    isDiagnosing: true,
    model: {
      phase: 'running',
      items: withResult('container-runtime', {
        status: 'ok',
        summary: 'docker socket 可达',
        durationText: '142ms',
      }),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('diagnostic-item-container-runtime')).toHaveAttribute(
      'data-status',
      'ok',
    );
    await expect(canvas.getByTestId('diagnostic-item-ws-loopback')).toHaveAttribute(
      'data-status',
      'pending',
    );
    // ⚠️ 诊断运行中**只有 [重新诊断] 被禁用**：非阻塞是产品要求。
    await expect(canvas.getByRole('button', { name: '诊断中…' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: '导出日志' })).toBeEnabled();
  },
};

/** 全部完成，含 ℹ️ 提示与 ⚠️ 建议。 */
export const Completed: Story = {
  args: {
    model: {
      phase: 'done',
      items: EIGHT.map((i) => {
        if (i.id === 'outbound-network') {
          return {
            ...i,
            status: 'warn' as const,
            summary: 'ghcr.io 连接超时',
            hint: 'HTTP_PROXY=http://127.0.0.1:7890 重启平台',
            durationText: '5s',
          };
        }
        if (i.id === 'preset-image') {
          return {
            ...i,
            status: 'info' as const,
            step: 'staged' as const,
            stepText: '检查链第 5 步 · 本机铺开（未铺开只影响首个任务的耗时）',
            summary: '预制镜像已就绪，但尚未在本机铺开 —— 首个任务需要数分钟准备镜像',
            durationText: '431ms',
          };
        }
        return { ...i, status: 'ok' as const, summary: '正常', durationText: '10ms' };
      }),
      summaryText: '6 项正常 · 1 项提示 · 1 项警告 · 0 项失败（含超时）· 整轮 5s',
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('diagnose-summary')).toHaveTextContent('含超时');
    // ⭐ 第 ⑧ 项是 ℹ️ 提示，**不是**警告（它没有东西需要修）。
    const preset = canvas.getByTestId('diagnostic-item-preset-image');
    await expect(preset).toHaveAttribute('data-status', 'info');
    await expect(preset).not.toHaveTextContent('警告');

    await userEvent.click(canvas.getByRole('button', { name: '复制' }));
    await expect(args.onCopyHint).toHaveBeenCalledWith('HTTP_PROXY=http://127.0.0.1:7890 重启平台');
  },
};

/** ⭐ 断流：已到达项**一条不清**，只在上方多一句「诊断中断」。 */
export const Aborted: Story = {
  args: {
    model: {
      phase: 'aborted',
      items: withResult('container-runtime', {
        status: 'ok',
        summary: 'docker socket 可达',
        durationText: '142ms',
      }),
      abortedText: '诊断中断：1/8 项已返回，其余项没有结论',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('diagnose-aborted')).toHaveTextContent('1/8');
    // ⚠️ 否定式的那一半：把中断做成"整块错误态盖住列表"之后，上面那条照样绿。
    await expect(canvas.getByTestId('diagnostic-item-container-runtime')).toHaveTextContent(
      'docker socket 可达',
    );
    await expect(canvas.getByRole('button', { name: '重新诊断' })).toBeEnabled();
  },
};

/** 全部失败（每项都有各自的建议，⛔ 不合成一个红灯）。 */
export const AllFailed: Story = {
  args: {
    model: {
      phase: 'done',
      items: EIGHT.map((i) => ({
        ...i,
        status: 'fail' as const,
        summary: `${i.label}：检查未通过`,
        hint: `修复 ${i.id}`,
        durationText: '10ms',
      })),
      summaryText: '0 项正常 · 0 项提示 · 0 项警告 · 8 项失败（含超时）· 整轮 5s',
    },
  },
};

/** schema hash 对不上：**提示不拦截**，帧照常渲染。 */
export const SchemaMismatch: Story = {
  args: {
    schemaMismatch: 'sb-diagnose-v99',
    model: {
      phase: 'done',
      items: withResult('container-runtime', {
        status: 'ok',
        summary: '正常',
        durationText: '9ms',
      }),
      summaryText: '1 项正常 · 0 项提示 · 0 项警告 · 0 项失败（含超时）· 整轮 5s',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status')).toHaveTextContent('sb-diagnose-v99');
    // 认得的项照常显示 —— 中断一次只读诊断等于在最需要它的时候把它关掉。
    await expect(canvas.getByTestId('diagnostic-item-container-runtime')).toHaveTextContent('正常');
  },
};
