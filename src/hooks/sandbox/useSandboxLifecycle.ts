import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { isSandboxStuck, STUCK_HINT_MS } from '@/lib/sandbox/taskPresentation';
import { useAppStore } from '@/stores';
import {
  classifyStatus,
  phaseIndexForStatus,
  STARTUP_PHASES,
  INSTANCE_PHASE_KEY,
  type LifecycleDecision,
  type StartupPhaseKey,
} from '@/lib/sandbox/sandboxLifecycle';
import { installSubCopy } from '@/lib/sandbox/runtimeInstallProgress';
import { formatElapsed, instanceSubCopy, startupSubtitle } from '@/lib/sandbox/instanceStartupCopy';
import { STARTUP_STAGE_COPY } from '@/lib/sandbox/startupObservation';
import {
  describeSandboxError,
  SANDBOX_ENDED_COPY,
  type SandboxErrorCopy,
} from '@/lib/sandbox/sandboxErrorCopy';
import { sandboxKeys } from '@/hooks/sandbox/useSandboxRestore';

const STARTUP_HEARTBEAT_FRESH_MS = 10_000;

export interface SandboxLifecycle {
  status: string | null;
  decision: LifecycleDecision;
  phases: readonly { key: string; label: string }[];
  activePhaseIndex: number;
  /** No measured whole-operation workload is currently available. */
  percent: number | null;
  phaseNote?: { phaseKey: StartupPhaseKey; text: string };
  subtitle?: string;
  elapsedLabel?: string;
  headline?: string;
  operationFacts?: { label: string; value: string }[];
  diagnosticOperationId?: string;
  waitingConfirmation: boolean;
  outcome: SandboxErrorCopy | null;
  stuckElapsed?: string;
  continueWaiting: () => void;
  checkStartup: () => void;
}

function elapsed(at: string | null | undefined, now: number): string | undefined {
  if (at === null || at === undefined || !Number.isFinite(Date.parse(at))) return undefined;
  return formatElapsed(now - Date.parse(at));
}

/** Original provision-cycle facts survive refresh; reads and waiting do not advance progress. */
export function useSandboxLifecycle(sandboxId: string | null): SandboxLifecycle {
  const client = useQueryClient();
  const runtime = useAppStore((s) =>
    sandboxId === null ? undefined : s.sandboxStatuses[sandboxId],
  );
  const install = useAppStore((s) =>
    sandboxId === null ? undefined : s.runtimeInstalls[sandboxId],
  );
  const instance = useAppStore((s) =>
    sandboxId === null ? undefined : s.instanceStartups[sandboxId],
  );
  const continueWaiting = useAppStore((s) => s.continueSandboxWaiting);
  const status = runtime?.status ?? null;
  const effective = status ?? 'pending';
  const observation = runtime?.startupObservation;
  const uncertain = runtime?.startupObservationUncertain === true;
  const decision: LifecycleDecision = status === null ? 'startup' : classifyStatus(effective);
  const ticking = (decision === 'startup' || decision === 'unknown') && observation !== undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [ticking]);

  return useMemo(() => {
    const progress =
      instance === undefined
        ? undefined
        : { phase: instance.phase, imageStaged: instance.imageStaged };
    const legacyNote = install === undefined ? instanceSubCopy(progress) : installSubCopy(install);
    const stageKey: StartupPhaseKey =
      observation?.stage === 'workspace-preparation'
        ? 'workspace'
        : observation?.stage === 'instance-create'
          ? 'image'
          : INSTANCE_PHASE_KEY;
    const activePhaseIndex =
      observation === undefined
        ? phaseIndexForStatus(effective)
        : STARTUP_PHASES.findIndex((phase) => phase.key === stageKey);
    const stageElapsed = elapsed(observation?.stageEnteredAt, now);
    const totalElapsed = elapsed(observation?.startedAt, now);
    const progressElapsed = elapsed(observation?.lastProgressAt, now);
    const heartbeatFresh =
      observation?.heartbeatAt !== null &&
      observation?.heartbeatAt !== undefined &&
      now - Date.parse(observation.heartbeatAt) <= STARTUP_HEARTBEAT_FRESH_MS;
    const waitingConfirmation =
      uncertain ||
      observation?.state === 'unknown' ||
      (observation?.state === 'inflight' && !heartbeatFresh) ||
      (observation?.state === 'inflight' &&
        observation.stage === 'instance-start' &&
        observation.stageEnteredAt !== null &&
        now - Date.parse(observation.stageEnteredAt) >= 120_000);
    const facts =
      observation === undefined
        ? undefined
        : [
            {
              label: '原启动请求',
              value:
                uncertain || observation.state === 'unknown'
                  ? '结果待确认'
                  : observation.state === 'inflight'
                    ? heartbeatFresh
                      ? '仍在执行'
                      : '已受理，结果待确认'
                    : observation.state === 'succeeded'
                      ? '已完成'
                      : '已确认失败',
            },
            {
              label: '当前准备阶段',
              value:
                uncertain || observation.state === 'unknown'
                  ? '准备阶段待确认'
                  : STARTUP_STAGE_COPY[observation.stage],
            },
            { label: '启动已用时间', value: totalElapsed ?? '待确认' },
            { label: '阶段已用时间', value: stageElapsed ?? '待确认' },
            {
              label: '最后实质进展',
              value: progressElapsed === undefined ? '待确认' : `${progressElapsed} 前`,
            },
            {
              label: '最近心跳',
              value:
                observation.heartbeatAt === null
                  ? '暂未确认'
                  : new Date(observation.heartbeatAt).toLocaleString(),
            },
            {
              label: '最近查询',
              value:
                observation.observedAt === null
                  ? '暂未确认'
                  : new Date(observation.observedAt).toLocaleString(),
            },
          ];
    const lastProgressAt =
      observation?.lastProgressAt === null || observation?.lastProgressAt === undefined
        ? null
        : Date.parse(observation.lastProgressAt);
    const dismissed = runtime?.waitingDismissedAt;
    const showStuck =
      lastProgressAt !== null &&
      isSandboxStuck(effective, lastProgressAt, now, false) &&
      (dismissed === undefined || now - dismissed >= STUCK_HINT_MS);
    const note = waitingConfirmation
      ? '暂未收到启动结果，正在确认原操作状态，不会重复启动。'
      : observation === undefined
        ? (legacyNote ?? '正在确认准备情况…')
        : `${STARTUP_STAGE_COPY[observation.stage]}；正在核对原启动请求。`;
    return {
      status,
      decision,
      phases: STARTUP_PHASES,
      activePhaseIndex,
      percent: null,
      phaseNote: {
        phaseKey: observation === undefined ? INSTANCE_PHASE_KEY : stageKey,
        text: note,
      },
      ...(observation === undefined && startupSubtitle(progress) !== undefined
        ? { subtitle: startupSubtitle(progress) }
        : {}),
      ...(stageElapsed === undefined ? {} : { elapsedLabel: stageElapsed }),
      ...(waitingConfirmation
        ? {
            headline:
              uncertain || observation?.state === 'unknown' || !heartbeatFresh
                ? '正在确认原启动请求的结果'
                : '启动请求仍在执行，正在确认结果',
          }
        : {}),
      ...(facts === undefined ? {} : { operationFacts: facts }),
      ...(observation === undefined ? {} : { diagnosticOperationId: observation.operationId }),
      waitingConfirmation,
      ...(showStuck && progressElapsed !== undefined ? { stuckElapsed: progressElapsed } : {}),
      continueWaiting: () => {
        if (sandboxId !== null) continueWaiting(sandboxId);
      },
      checkStartup: () => {
        if (sandboxId !== null)
          void client.invalidateQueries({ queryKey: sandboxKeys.detail(sandboxId), exact: true });
      },
      outcome:
        decision === 'failed'
          ? describeSandboxError({ code: runtime?.failureCode, detail: runtime?.failureMessage })
          : decision === 'ended'
            ? SANDBOX_ENDED_COPY
            : null,
    };
  }, [
    sandboxId,
    client,
    runtime,
    install,
    instance,
    continueWaiting,
    status,
    effective,
    decision,
    observation,
    uncertain,
    now,
  ]);
}
