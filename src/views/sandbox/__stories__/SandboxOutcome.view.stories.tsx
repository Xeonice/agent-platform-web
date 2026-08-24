import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SandboxOutcomeView } from '@/views/sandbox/SandboxOutcome.view';

const noop = (): void => undefined;

const meta: Meta<typeof SandboxOutcomeView> = {
  title: 'Sandbox/Outcome',
  component: SandboxOutcomeView,
  parameters: { layout: 'fullscreen' },
  args: { onAction: noop, tone: 'failed' },
};
export default meta;

type Story = StoryObj<typeof SandboxOutcomeView>;

/**
 * `INSTALL_FAILED`（P22 §1）：**已落库、`starting` 段中途失败** ⇒ 走正常失败态，给 [重试]。
 */
export const InstallFailed: Story = {
  args: {
    title: '❌ 运行时 CLI 安装失败（该镜像未预装，现装未成功）',
    advice:
      '安装发生在「启动实例」阶段内，失败时任务已停止。可以重试一次；反复失败建议换一张**预装该 CLI**的镜像（未预装的镜像现装可能耗时十几分钟）。',
    actions: [
      { key: 'retry', label: '重试' },
      { key: 'reconfigure', label: '换一张预装该 CLI 的镜像' },
    ],
    diagnosticCode: 'INSTALL_FAILED',
    taskName: '分析这个仓库的架构并输出…',
  },
};

/**
 * `IMAGE_CONTRACT_VIOLATION`（P22 §1）：镜像实测缺 tmux。
 * **刻意不给 [重试]**——重试不会改变镜像内容，唯一出路是换镜像。
 */
export const ImageContractViolation: Story = {
  args: {
    title: '❌ 镜像不满足平台约定（缺少 tmux），任务已停止',
    advice:
      '这张镜像注册时通过了校验，但真正启动时实测发现缺 tmux（镜像换了 tag 或上游变更）。tmux 是必须项——没有它，平台一重启就会丢掉正在跑的 agent 会话，因此不做静默降级。',
    actions: [{ key: 'reconfigure', label: '换一张含 tmux 的镜像' }],
    diagnosticCode: 'IMAGE_CONTRACT_VIOLATION',
    // failureMessage：后端已把码与自由文本拆成两列，这里只原样展示细节（不从中 parse 码）。
    detail: 'command -v tmux exited 1',
  },
};

/** 未知/缺码时的兜底：仍给人话 + 可点动作（P22 §1 禁止裸抛错误码）。 */
export const UnknownFailure: Story = {
  args: {
    title: '❌ 任务启动失败',
    advice: '未能获取具体原因，可以重试一次；若持续失败请查看系统状态。',
    actions: [
      { key: 'retry', label: '重试' },
      { key: 'reconfigure', label: '返回重新配置' },
    ],
    diagnosticCode: 'UNKNOWN',
  },
};

/** 正常结束（非失败）：不出红字告警。 */
export const Ended: Story = {
  args: {
    tone: 'ended',
    title: '沙箱已停止',
    advice: '该任务的沙箱已结束，可以重新创建一个。',
    actions: [{ key: 'reconfigure', label: '重新创建' }],
    diagnosticCode: 'stopped',
  },
};
