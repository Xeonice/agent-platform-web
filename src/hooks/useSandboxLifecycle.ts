// 从 sandbox 状态 store 派生生命周期决策（hook 可 import lib；view 只吃派生结果）。
import { useMemo } from 'react';
import { useAppStore } from '@/stores';
import {
  classifyStatus,
  phaseIndexForStatus,
  startupPercent,
  STARTUP_PHASES,
  type LifecycleDecision,
} from '@/lib/sandboxLifecycle';

export interface SandboxLifecycle {
  /** 当前后端 status（无记录时为 null）。 */
  status: string | null;
  decision: LifecycleDecision;
  /** 启动四阶段（label 列表）。 */
  phases: readonly { key: string; label: string }[];
  /** 当前阶段下标。 */
  activePhaseIndex: number;
  /** 启动进度百分比（running 前 < 100）。 */
  percent: number;
}

/** 无记录时按 startup(pending) 兜底：create 刚发出、事件未到时展示"启动中"而非空白。 */
export function useSandboxLifecycle(sandboxId: string | null): SandboxLifecycle {
  const runtime = useAppStore((s) =>
    sandboxId === null ? undefined : s.sandboxStatuses[sandboxId],
  );
  const status = runtime?.status ?? null;

  return useMemo(() => {
    const effective = status ?? 'pending';
    return {
      status,
      decision: status === null ? 'startup' : classifyStatus(effective),
      phases: STARTUP_PHASES,
      activePhaseIndex: phaseIndexForStatus(effective),
      percent: startupPercent(effective),
    };
  }, [status]);
}
