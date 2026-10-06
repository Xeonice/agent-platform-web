'use client';
// 沙箱生命周期门（10 §7.4 / P20 §3.3）：读 /events 驱动的 status（订阅在 WorkbenchContainer 全局），
// 据 status 在「启动中进度 → 终端 → 失败/结束」间切换。终端只在 running 才开。
//
// 终端语义（S5 裁决 T-2）：agent 会话由**后端在 provision 的「启动实例」阶段**起好并开始执行，
// 终端网关一律 attach 已存在的会话 —— 打开终端不再是"开工开关"，而是接管一个可能已有输出的会话。
import type { ReactNode } from 'react';
import { useSandboxLifecycle } from '@/hooks/sandbox/useSandboxLifecycle';
import { TerminalTabsContainer } from '@/containers/terminal/TerminalTabsContainer';
import { SandboxStartupProgressView } from '@/views/sandbox/SandboxStartupProgress.view';
import { SandboxOutcomeView } from '@/views/sandbox/SandboxOutcome.view';
import { TaskActionsContainer } from '@/containers/sandbox/TaskActionsContainer';
import { useSandboxOperations } from '@/hooks/sandbox/useSandboxOperations';
import { useAppStore } from '@/stores';
import type { TerminalSocketConfig } from '@/types/terminal';
import type { TaskImageSnapshot } from '@/types/image';
import { useTaskImageView } from '@/hooks/image/useTaskImageView';
import { useSandboxOutcomeActions } from '@/hooks/sandbox/useSandboxOutcomeActions';

export interface SandboxLifecycleContainerProps {
  sandboxId: string;
  /** 必须由 REST/创建 DTO 确认，运行状态不能代替运行方式。 */
  headless: boolean;
  /** 这个沙箱里能跑哪几个 agent CLI（06 §5.6），透传给终端标签栏。 */
  availableRuntimes?: readonly string[];
  socketConfig: TerminalSocketConfig;
  /** 失败/结束态的重试入口（回到新建面板）。 */
  onRetry: (omitRuntime?: boolean, fromFailure?: boolean) => void;
  image?: TaskImageSnapshot;
  projectId?: string;
  /** 后端派生的默认任务名（10 §7.3）；前端不自己从 prompt 派生。 */
  taskName?: string;
  /**
   * 无头 Task 面板（S6）。**只在 running 的无头分支渲染**，不附着交互式 Agent：
   * 无头任务和终端共用凭证，挂终端可能额外启动一个交互式会话。
   * 沙箱还没起来时发无头任务必然失败，
   * 入口不该存在。用插槽而不是在本层直接装配，是为了让本容器继续只依赖 sandbox 生命周期，
   * 不必知道 provider 能力位/runtime 这些与它无关的东西（与 WorkbenchShellView 的 terminalSlot 同一手法）。
   */
  headlessSlot?: ReactNode;
}

export function SandboxLifecycleContainer({
  sandboxId,
  headless,
  availableRuntimes,
  socketConfig,
  onRetry,
  taskName,
  headlessSlot,
  image,
  projectId,
}: SandboxLifecycleContainerProps) {
  const {
    decision,
    status,
    phases,
    activePhaseIndex,
    percent,
    phaseNote,
    subtitle,
    elapsedLabel,
    outcome,
    stuckElapsed,
    continueWaiting,
  } = useSandboxLifecycle(sandboxId);

  const operation = useSandboxOperations(sandboxId, taskName ?? '未命名任务', projectId);
  const failureOperation = useAppStore((s) => s.sandboxStatuses[sandboxId]?.failureOperation);
  const restarting = useAppStore((s) => s.sandboxStatuses[sandboxId]?.restarting);
  const imageView = useTaskImageView(image);
  const actions = useSandboxOutcomeActions({
    sandboxId,
    projectId,
    taskName,
    image,
    failed: decision === 'failed',
    code: outcome?.code,
    title: outcome?.title,
    onRetry,
  });

  if (decision === 'running') {
    if (headless) {
      return <div className="flex h-full min-h-0 flex-col">{headlessSlot}</div>;
    }
    return (
      // 对象菜单已在共享顶栏和任务树；主区直接从终端栏开始（f-wb-live-01）。
      <TerminalTabsContainer
        sandboxId={sandboxId}
        socketConfig={socketConfig}
        disabledReason={status === 'stopping' ? '正在停止，暂时不能新建终端。' : undefined}
        {...(availableRuntimes === undefined ? {} : { availableRuntimes })}
      />
    );
  }

  if ((decision === 'failed' || decision === 'ended') && outcome !== null) {
    return (
      <SandboxOutcomeView
        tone={decision === 'failed' ? 'failed' : 'ended'}
        severity={outcome.severity}
        title={outcome.title}
        advice={
          failureOperation === 'destroy'
            ? `${outcome.advice} 容器服务起来之后再销毁一次。`
            : outcome.advice
        }
        footnote={
          failureOperation === 'stop'
            ? '这次是在 [停止] 时失败的；任务已转为异常，名额已释放。'
            : failureOperation === 'start'
              ? '这次是在 [启动] 时失败的，原来的代码副本还在。'
              : failureOperation === 'destroy'
                ? '这次是在销毁任务时失败的，名额已释放；删除是幂等操作，可以放心再试。'
                : undefined
        }
        actionsSlot={
          failureOperation === 'destroy' ? (
            <TaskActionsContainer
              id={sandboxId}
              name={taskName ?? '未命名任务'}
              projectId={projectId}
              status="failed"
              showCancel
              triggerLabel="销毁任务…"
            />
          ) : undefined
        }
        actions={(decision === 'ended'
          ? [
              { key: 'start', label: '启动' },
              { key: 'new', label: '发起新任务' },
            ]
          : failureOperation === 'destroy'
            ? []
            : outcome.actions
        ).map((action) => ({
          ...action,
          label: action.key === 'retry' && decision === 'failed' ? '重新发起' : action.label,
        }))}
        // 两个动作在本切片都回到新建入口：`retry` = 同配置再来一次；
        // `reconfigure` = 回去改配置（镜像下拉属 F21-2，落地后 handler 分叉到向导确认步）。
        onAction={(key) => {
          if (key === 'start') operation.start();
          else if (key === 'new') onRetry(true, false);
          else actions.onAction(key);
        }}
        taskName={taskName}
        imageLabel={imageView.label}
        imageDiagnostic={imageView.diagnostic}
        onRunDiagnostics={actions.runDiagnostics}
        // failureMessage：只原样透出给排障，人话仍由 outcome.title/advice 按码给（不 parse 它）。
        detail={outcome.detail}
        /**
         * ⚠️ **`ended` 分支不传 diagnosticCode。**
         *
         * 它此前传的是**原始 status**（`stopped` / `destroyed` / …），于是一次正常的停止
         * 会在卡片上渲染出「诊断码：stopped」—— 那不是任何一个错误码，用户拿着它去报障
         * 只会浪费两边的时间。`failed` 那一支传的才是真码（`outcome.code`）。
         * 原始 status 仍然在进度卡上以 `data-status` 挂着，排障/e2e 取得到。
         */
        {...(decision === 'failed' && outcome.code !== 'UNKNOWN' && outcome.code !== ''
          ? { diagnosticCode: outcome.code }
          : {})}
        onCopyDiagnostics={actions.copyDiagnostics}
      />
    );
  }

  // startup / unknown：展示启动中四阶段进度（含装 CLI 子文案，可能持续十几分钟）。
  return (
    <SandboxStartupProgressView
      stuckElapsed={stuckElapsed}
      stuckNote={
        status === 'creating'
          ? '拉取镜像通常会持续推进；这么久没有任何进展，多半是网络或镜像下载源的问题。'
          : undefined
      }
      onContinue={continueWaiting}
      cancelSlot={
        <TaskActionsContainer
          id={sandboxId}
          name={taskName ?? '未命名任务'}
          projectId={projectId}
          status={status ?? undefined}
          showCancel
        />
      }
      phases={phases}
      activeIndex={activePhaseIndex}
      percent={percent}
      /**
       * ⚠️ **原始 status 不上屏**（P22 §6：原始 status / 错误码 / 字段名只进日志与 data 属性）。
       * 它此前走 `statusLabel` ⇒ 进度卡副标题上真的出现了「（preparing-workspace）」。
       * 改挂 `data-status`：e2e 与排障照样取得到，用户看不到。
       */
      dataStatus={status ?? undefined}
      subtitle={restarting ? '从已停止重新启动：沿用原来的代码副本，Agent 会话从头开始' : subtitle}
      reused={restarting === true}
      footnote={
        restarting
          ? '原来的任务指令不会再执行一遍（上次启动时已经执行过）；启动好后回到终端。'
          : undefined
      }
      taskName={taskName}
      imageLabel={imageView.label}
      phaseNote={phaseNote}
      activeElapsedLabel={elapsedLabel}
    />
  );
}
