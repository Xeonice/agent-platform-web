// 从 sandbox 状态 store 派生生命周期决策（hook 可 import lib；view 只吃派生结果）。
import { useMemo } from 'react';
import { useAppStore } from '@/stores';
import {
  classifyStatus,
  phaseIndexForStatus,
  startupPercent,
  STARTUP_PHASES,
  INSTANCE_PHASE_KEY,
  type LifecycleDecision,
  type StartupPhaseKey,
} from '@/lib/sandboxLifecycle';
import { installSubCopy } from '@/lib/runtimeInstallProgress';
import {
  describeSandboxError,
  SANDBOX_ENDED_COPY,
  type SandboxErrorCopy,
} from '@/lib/sandboxErrorCopy';

export interface SandboxLifecycle {
  /** 当前后端 status（无记录时为 null）。 */
  status: string | null;
  decision: LifecycleDecision;
  /** 启动四阶段（**展示序**：初始化 / 拉取镜像 / 准备工作区 / 启动实例）。 */
  phases: readonly { key: string; label: string }[];
  /** 当前展示格下标。 */
  activePhaseIndex: number;
  /** 启动进度百分比（running 前 < 100）。 */
  percent: number;
  /**
   * 挂在某一格下的子文案：目前唯一来源是 `runtime.install_progress`（装 CLI 可达 12.5 分钟）。
   * undefined = 本次没有子文案。
   */
  phaseNote?: { phaseKey: StartupPhaseKey; text: string };
  /** failed / ended 决策下的人话呈现（P22 §1：人话 + 可操作建议）；其余决策为 null。 */
  outcome: SandboxErrorCopy | null;
}

/** 无记录时按 startup(pending) 兜底：create 刚发出、事件未到时展示"启动中"而非空白。 */
export function useSandboxLifecycle(sandboxId: string | null): SandboxLifecycle {
  const runtime = useAppStore((s) =>
    sandboxId === null ? undefined : s.sandboxStatuses[sandboxId],
  );
  const install = useAppStore((s) =>
    sandboxId === null ? undefined : s.runtimeInstalls[sandboxId],
  );
  const status = runtime?.status ?? null;
  // 失败原因的**唯一**来源：WS status_changed.errorCode（即时）/ DTO failureCode（刷新恢复）
  // 已在 store 里归一到同一个字段。install_progress 不参与（10 §3.1）。
  const failureCode = runtime?.failureCode;
  const failureMessage = runtime?.failureMessage;
  const installStatus = install?.status;
  const installRuntime = install?.runtime;
  const installVersion = install?.versionDetected;

  return useMemo(() => {
    const effective = status ?? 'pending';
    const decision: LifecycleDecision = status === null ? 'startup' : classifyStatus(effective);
    const note =
      installStatus === undefined || installRuntime === undefined
        ? undefined
        : installSubCopy({
            runtime: installRuntime,
            status: installStatus,
            versionDetected: installVersion,
          });

    return {
      status,
      decision,
      phases: STARTUP_PHASES,
      activePhaseIndex: phaseIndexForStatus(effective),
      percent: startupPercent(effective),
      // 装 CLI 的子文案永远挂「启动实例」格——装 CLI/注凭证/起 agent 会话都在 starting 段内（03 §4.3）。
      ...(note === undefined ? {} : { phaseNote: { phaseKey: INSTANCE_PHASE_KEY, text: note } }),
      outcome:
        decision === 'failed'
          ? // 人话按**码**查 P22 §1；failureMessage 是纯自由文本细节，只作为排障小字原样透出，
            // **绝不 parse 它取码**（后端已把码与文本拆成两列）。拿不到码时给兜底人话，不裸抛码。
            describeSandboxError({ code: failureCode, detail: failureMessage })
          : decision === 'ended'
            ? SANDBOX_ENDED_COPY
            : null,
    };
  }, [status, failureCode, failureMessage, installStatus, installRuntime, installVersion]);
}
