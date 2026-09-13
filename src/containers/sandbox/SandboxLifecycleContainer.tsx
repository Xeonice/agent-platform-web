'use client';
// 沙箱生命周期门（10 §7.4 / P20 §3.3）：读 /events 驱动的 status（订阅在 WorkbenchContainer 全局），
// 据 status 在「启动中进度 → 终端 → 失败/结束」间切换。终端只在 running 才开。
//
// 终端语义（S5 裁决 T-2）：agent 会话由**后端在 provision 的「启动实例」阶段**起好并开始执行，
// 终端网关一律 attach 已存在的会话 —— 打开终端不再是"开工开关"，而是接管一个可能已有输出的会话。
import { useCallback, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useSandboxLifecycle } from '@/hooks/sandbox/useSandboxLifecycle';
import { TerminalTabsContainer } from '@/containers/terminal/TerminalTabsContainer';
import { SandboxStartupProgressView } from '@/views/sandbox/SandboxStartupProgress.view';
import { SandboxOutcomeView } from '@/views/sandbox/SandboxOutcome.view';
import type { TerminalSocketConfig } from '@/types/terminal';

export interface SandboxLifecycleContainerProps {
  sandboxId: string;
  /** 这个沙箱里能跑哪几个 agent CLI（06 §5.6），透传给终端标签栏。 */
  availableRuntimes?: readonly string[];
  socketConfig: TerminalSocketConfig;
  /** 失败/结束态的重试入口（回到新建面板）。 */
  onRetry: () => void;
  /** 后端派生的默认任务名（10 §7.3）；前端不自己从 prompt 派生。 */
  taskName?: string;
  /**
   * 终端仪表壳工具栏的面包屑（design-notes.md §4 Phase 3），只在 `running` 分支
   * 转发给 `TerminalTabsContainer`——启动中/失败/结束态没有终端可挂工具栏。
   */
  breadcrumb?: string;
  /**
   * 无头 Task 面板（S6）。**只在 running 分支渲染**：沙箱还没起来时发无头任务必然失败，
   * 入口不该存在。用插槽而不是在本层直接装配，是为了让本容器继续只依赖 sandbox 生命周期，
   * 不必知道 provider 能力位/runtime 这些与它无关的东西（与 WorkbenchShellView 的 terminalSlot 同一手法）。
   */
  headlessSlot?: ReactNode;
}

export function SandboxLifecycleContainer({
  sandboxId,
  availableRuntimes,
  socketConfig,
  onRetry,
  taskName,
  headlessSlot,
  breadcrumb,
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
  } = useSandboxLifecycle(sandboxId);

  /**
   * [复制诊断信息]：错误码 / detail / traceId 一起进剪贴板交给管理员，**正文不出现码**
   *（P22 §1 禁止裸抛错误码；`SandboxOutcome.view` 头注释也一直是这么写的）。
   *
   * ⚠️ 剪贴板在 container 而不是 view（07 §3 规则 2）：`navigator.clipboard` 在
   * 非 HTTPS 的局域网部署下**干脆不存在**，读 `.writeText` 当场抛 TypeError。
   * ⛔ 失败不许静默：静默时用户会去粘贴一段**上一次**复制的内容。
   */
  const handleCopyDiagnostics = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => {
        toast.success('诊断信息已复制');
      },
      () => {
        toast.error('复制失败，请手动选中下面的失败细节复制');
      },
    );
  }, []);

  if (decision === 'running') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">
          {/*
            多标签（P21-1 §6 / 08 §5）：Agent 那个会话是第 1 个标签，用户可以再开
            独立终端。⚠️ `sessionId` 不再从这里传下去 —— 标签身份由
            `useTerminalSessions` 按 sandboxId 派生（Agent 那个仍是 `<id>:0`），
            让"有哪几个标签"只有一个知情者。
          */}
          <TerminalTabsContainer
            sandboxId={sandboxId}
            socketConfig={socketConfig}
            {...(availableRuntimes === undefined ? {} : { availableRuntimes })}
            {...(breadcrumb === undefined ? {} : { breadcrumb })}
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
        severity={outcome.severity}
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
        /**
         * ⚠️ **`ended` 分支不传 diagnosticCode。**
         *
         * 它此前传的是**原始 status**（`stopped` / `destroyed` / …），于是一次正常的停止
         * 会在卡片上渲染出「诊断码：stopped」—— 那不是任何一个错误码，用户拿着它去报障
         * 只会浪费两边的时间。`failed` 那一支传的才是真码（`outcome.code`）。
         * 原始 status 仍然在进度卡上以 `data-status` 挂着，排障/e2e 取得到。
         */
        {...(decision === 'failed' ? { diagnosticCode: outcome.code } : {})}
        onCopyDiagnostics={handleCopyDiagnostics}
      />
    );
  }

  // startup / unknown：展示启动中四阶段进度（含装 CLI 子文案，可能持续十几分钟）。
  return (
    <SandboxStartupProgressView
      phases={phases}
      activeIndex={activePhaseIndex}
      percent={percent}
      /**
       * ⚠️ **原始 status 不上屏**（P22 §6：原始 status / 错误码 / 字段名只进日志与 data 属性）。
       * 它此前走 `statusLabel` ⇒ 进度卡副标题上真的出现了「（preparing-workspace）」。
       * 改挂 `data-status`：e2e 与排障照样取得到，用户看不到。
       */
      dataStatus={status ?? undefined}
      subtitle={subtitle}
      taskName={taskName}
      phaseNote={phaseNote}
      activeElapsedLabel={elapsedLabel}
    />
  );
}
