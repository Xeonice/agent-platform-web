'use client';
// 沙箱生命周期门（10 §7.4 / P20 §3.3）：读 /events 驱动的 status（订阅在 WorkbenchContainer 全局），
// 据 status 在「启动中进度 → 终端 → 失败/结束」间切换。终端只在 running 才开。
//
// 终端语义（S5 裁决 T-2）：agent 会话由**后端在 provision 的「启动实例」阶段**起好并开始执行，
// 终端网关一律 attach 已存在的会话 —— 打开终端不再是"开工开关"，而是接管一个可能已有输出的会话。
import type { ReactNode } from 'react';
import { useSandboxLifecycle } from '@/hooks/sandbox/useSandboxLifecycle';
import { TerminalContainer } from '@/containers/TerminalContainer';
import { SandboxStartupProgressView } from '@/views/sandbox/SandboxStartupProgress.view';
import { SandboxOutcomeView } from '@/views/sandbox/SandboxOutcome.view';
import type { TerminalSocketConfig } from '@/types/terminal';

export interface SandboxLifecycleContainerProps {
  sessionId: string;
  sandboxId: string;
  socketConfig: TerminalSocketConfig;
  /** 失败/结束态的重试入口（回到新建面板）。 */
  onRetry: () => void;
  /** 后端派生的默认任务名（10 §7.3）；前端不自己从 prompt 派生。 */
  taskName?: string;
  /**
   * 无头 Task 面板（S6）。**只在 running 分支渲染**：沙箱还没起来时发无头任务必然失败，
   * 入口不该存在。用插槽而不是在本层直接装配，是为了让本容器继续只依赖 sandbox 生命周期，
   * 不必知道 provider 能力位/runtime 这些与它无关的东西（与 WorkbenchShellView 的 terminalSlot 同一手法）。
   */
  headlessSlot?: ReactNode;
}

export function SandboxLifecycleContainer({
  sessionId,
  sandboxId,
  socketConfig,
  onRetry,
  taskName,
  headlessSlot,
}: SandboxLifecycleContainerProps) {
  const { decision, status, phases, activePhaseIndex, percent, phaseNote, outcome } =
    useSandboxLifecycle(sandboxId);

  if (decision === 'running') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">
          <TerminalContainer
            sessionId={sessionId}
            sandboxId={sandboxId}
            socketConfig={socketConfig}
          />
        </div>
        {headlessSlot}
      </div>
    );
  }

  if ((decision === 'failed' || decision === 'ended') && outcome !== null) {
    return (
      <SandboxOutcomeView
        tone={decision === 'failed' ? 'failed' : 'ended'}
        title={outcome.title}
        advice={outcome.advice}
        actions={outcome.actions}
        // 两个动作在本切片都回到新建入口：`retry` = 同配置再来一次；
        // `reconfigure` = 回去改配置（镜像下拉属 F21-2，落地后 handler 分叉到向导确认步）。
        onAction={() => {
          onRetry();
        }}
        taskName={taskName}
        // failureMessage：只原样透出给排障，人话仍由 outcome.title/advice 按码给（不 parse 它）。
        detail={outcome.detail}
        diagnosticCode={decision === 'failed' ? outcome.code : (status ?? undefined)}
      />
    );
  }

  // startup / unknown：展示启动中四阶段进度（含装 CLI 子文案，可能持续十几分钟）。
  return (
    <SandboxStartupProgressView
      phases={phases}
      activeIndex={activePhaseIndex}
      percent={percent}
      statusLabel={status ?? undefined}
      taskName={taskName}
      phaseNote={phaseNote}
    />
  );
}
