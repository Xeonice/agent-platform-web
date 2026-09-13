import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { DiagnosticsCardView } from '@/views/system/DiagnosticsCard.view';
import type { DiagnosticItemModel, DiagnosticsCardModel } from '@/types/system';

const EIGHT: DiagnosticItemModel[] = [
  { id: 'container-runtime', label: '容器服务可达' },
  { id: 'dev-kvm', label: '轻量虚拟机沙箱可用' },
  { id: 'disk-space', label: '磁盘余量' },
  { id: 'port-conflict', label: '端口占用' },
  { id: 'outbound-network', label: '外网连通（模型 API / 镜像仓库）' },
  { id: 'ws-loopback', label: '实时推送自检' },
  { id: 'data-root-fs', label: '数据目录文件系统' },
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
    const idle = canvas.getByText(/尚未运行/);
    await expect(idle).toBeInTheDocument();
    // ⛔ **不许把超时预算抄进界面文案。** 上一版写死「单项 5s 超时」，而后端的
    //    `DIAGNOSE_TIMEOUT_MS` 早已是 10s —— 一个抄在界面上的常量必然漂移，而它对用户
    //    的下一个动作没有任何区别（等就是了）。真实预算由首帧 `start.timeoutMs` 下发。
    // MUTATION: 把秒数写回这句话 ⇒ 本条红。
    await expect(idle).not.toHaveTextContent(/\d+\s*s\b/);
    await expect(idle).not.toHaveTextContent(/\d+\s*秒/);
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
        headline: '容器服务可达',
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
            headline: '拉不到新镜像，Agent 仍可用',
            detailText: 'ghcr.io 未在超时时限内应答。',
            nextStep: '重跑一次看它稳不稳定；每次都这样就在系统设置里填代理后重试。',
            command: 'HTTPS_PROXY=http://127.0.0.1:7890',
            durationText: '7s',
          };
        }
        if (i.id === 'preset-image') {
          return {
            ...i,
            status: 'info' as const,
            step: 'staged' as const,
            stepText:
              '前 4 步已通过，已到第 5 步（共 5 步） · 有没有下载到本机（没下载只影响首个任务的耗时）',
            headline: '镜像还没下载到本机',
            detailText: '镜像本身没问题，只是这台机器上还没有它的副本（压缩后约 0.3GB）。',
            durationText: '431ms',
          };
        }
        return { ...i, status: 'ok' as const, headline: '正常', durationText: '10ms' };
      }),
      // ⛔ 为零的那一档不写出来（「0 项失败」对用户的下一步没有任何区别）。
      summaryText: '6 项正常 · 1 项提示 · 1 项警告 · 整轮 7s',
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // ⛔ 全都没失败时汇总里不出现「0 项失败」，「含超时」那半句跟着它一起消失。
    await expect(canvas.getByTestId('diagnose-summary')).not.toHaveTextContent('0 项');
    // ⭐ 预制镜像那一项是 ℹ️ 提示，**不是**警告（它没有东西需要修）。
    const preset = canvas.getByTestId('diagnostic-item-preset-image');
    await expect(preset).toHaveAttribute('data-status', 'info');
    await expect(preset).not.toHaveTextContent('警告');

    // 命令在展开层里，且复制的是**命令原文**（散文不进复制框）。
    await userEvent.click(canvas.getByTestId('diagnostic-toggle-outbound-network'));
    await userEvent.click(canvas.getByRole('button', { name: '复制' }));
    await expect(args.onCopyHint).toHaveBeenCalledWith('HTTPS_PROXY=http://127.0.0.1:7890');
  },
};

/** ⭐ 断流：已到达项**一条不清**，只在上方多一句「诊断中断」。 */
export const Aborted: Story = {
  args: {
    model: {
      phase: 'aborted',
      items: withResult('container-runtime', {
        status: 'ok',
        headline: '容器服务可达',
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
      '容器服务可达',
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
        headline: `${i.label}未通过`,
        nextStep: `按这一项自己的办法修：${i.id}`,
        durationText: '10ms',
      })),
      summaryText: '0 项正常 · 8 项失败（含超时）· 整轮 5s',
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
        headline: '正常',
        durationText: '9ms',
      }),
      summaryText: '1 项全部正常 · 整轮 5s',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status')).toHaveTextContent('sb-diagnose-v99');
    // 认得的项照常显示 —— 中断一次只读诊断等于在最需要它的时候把它关掉。
    await expect(canvas.getByTestId('diagnostic-item-container-runtime')).toHaveTextContent('正常');
  },
};
