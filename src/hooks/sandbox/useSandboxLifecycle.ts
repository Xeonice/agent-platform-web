// 从 sandbox 状态 store 派生生命周期决策（hook 可 import lib；view 只吃派生结果）。
import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/stores';
import {
  classifyStatus,
  phaseIndexForStatus,
  startupPercent,
  STARTUP_PHASES,
  INSTANCE_PHASE_KEY,
  type LifecycleDecision,
  type StartupPhaseKey,
} from '@/lib/sandbox/sandboxLifecycle';
import { installSubCopy } from '@/lib/sandbox/runtimeInstallProgress';
import { formatElapsed, instanceSubCopy } from '@/lib/sandbox/instanceStartupCopy';
import {
  describeSandboxError,
  SANDBOX_ENDED_COPY,
  type SandboxErrorCopy,
} from '@/lib/sandbox/sandboxErrorCopy';

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
   * 挂在某一格下的子文案。两个来源都落「启动实例」格，且**前后相继**：
   * `sandbox.instance_progress`（起实例，冷镜像实测 190s）→ `runtime.install_progress`
   * （装 CLI，实测可达 753s）。后者一旦到达就接管——它是更晚的那一步，起实例的文案
   * 此刻已经是过去时。undefined = 本次没有子文案。
   */
  phaseNote?: { phaseKey: StartupPhaseKey; text: string };
  /**
   * 当前启动阶段的「已等待」显示串（`3:10`）。**完全由前端算**：锚点是本页收到那条
   * `status_changed` 的时刻（store 的 `observedAt`），后端不推任何耗时字段。
   *
   * undefined 有两种情况，都必须**不显示**而不是显示 0：① 不在启动中；② 刷新恢复出来的
   * 状态没有锚点（DTO 上没有"何时进入该状态"的时间戳，从 0 数会给出一个看起来精确、
   * 实际上编的数字）。
   */
  elapsedLabel?: string;
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
  const instance = useAppStore((s) =>
    sandboxId === null ? undefined : s.instanceStartups[sandboxId],
  );
  const status = runtime?.status ?? null;
  // 失败原因的**唯一**来源：WS status_changed.errorCode（即时）/ DTO failureCode（刷新恢复）
  // 已在 store 里归一到同一个字段。install_progress 不参与（10 §3.1）。
  const failureCode = runtime?.failureCode;
  const failureMessage = runtime?.failureMessage;
  const installStatus = install?.status;
  const installRuntime = install?.runtime;
  const installVersion = install?.versionDetected;
  const instancePhase = instance?.phase;
  const imageStaged = instance?.imageStaged;
  const observedAt = runtime?.observedAt;

  const effective = status ?? 'pending';
  const decision: LifecycleDecision = status === null ? 'startup' : classifyStatus(effective);

  /**
   * 秒级心跳，**只在启动中且真的有锚点时才跑**。没有这两个条件就一个定时器都不建：
   * 一个 running 的沙箱每秒重渲染一次，是为了一行不会显示的文案付整页的代价。
   */
  const ticking = decision === 'startup' && observedAt !== undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now()); // 立刻对齐一次，别让首帧停在上一次卸载时的旧值
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [ticking, observedAt]);

  return useMemo(() => {
    const note =
      installStatus === undefined || installRuntime === undefined
        ? instanceSubCopy(
            instancePhase === undefined ? undefined : { phase: instancePhase, imageStaged },
          )
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
      // 两个来源的子文案都永远挂「启动实例」格——起实例/装 CLI/注凭证/起 agent 会话
      // 全在 starting 段内（03 §4.3）。
      ...(note === undefined ? {} : { phaseNote: { phaseKey: INSTANCE_PHASE_KEY, text: note } }),
      // `ticking` 已经蕴含 observedAt 有值（它就是由这个条件构成的）——再判一次会被
      // `no-unnecessary-condition` 判死，也确实是一句永远为真的话。
      ...(ticking ? { elapsedLabel: formatElapsed(now - observedAt) } : {}),
      outcome:
        decision === 'failed'
          ? // 人话按**码**查 P22 §1；failureMessage 是纯自由文本细节，只作为排障小字原样透出，
            // **绝不 parse 它取码**（后端已把码与文本拆成两列）。拿不到码时给兜底人话，不裸抛码。
            describeSandboxError({ code: failureCode, detail: failureMessage })
          : decision === 'ended'
            ? SANDBOX_ENDED_COPY
            : null,
    };
  }, [
    status,
    effective,
    decision,
    failureCode,
    failureMessage,
    installStatus,
    installRuntime,
    installVersion,
    instancePhase,
    imageStaged,
    ticking,
    observedAt,
    now,
  ]);
}
