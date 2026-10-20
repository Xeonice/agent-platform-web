import type { StartupObservation } from '@/types/ws-protocol';

export interface StartupObservationMerge {
  observation: StartupObservation | undefined;
  uncertain: boolean;
  ignored: boolean;
}

/** REST and events share a provision cycle; only actual operation events advance its sequence. */
export function receiveStartupObservation(
  previous: StartupObservation | undefined,
  next: StartupObservation | undefined,
): StartupObservationMerge {
  if (next === undefined) return { observation: previous, uncertain: false, ignored: false };
  if (previous === undefined) return { observation: next, uncertain: false, ignored: false };
  if (previous.operationId !== next.operationId) {
    const before = previous.startedAt === null ? NaN : Date.parse(previous.startedAt);
    const after = next.startedAt === null ? NaN : Date.parse(next.startedAt);
    if (!Number.isFinite(after) || (Number.isFinite(before) && after < before))
      return { observation: previous, uncertain: true, ignored: true };
    return { observation: next, uncertain: false, ignored: false };
  }
  if (next.sequence < previous.sequence)
    return { observation: previous, uncertain: false, ignored: true };
  const beforeFacts = { ...previous, observedAt: null };
  const afterFacts = { ...next, observedAt: null };
  if (
    next.sequence === previous.sequence &&
    JSON.stringify(beforeFacts) !== JSON.stringify(afterFacts)
  )
    return { observation: previous, uncertain: true, ignored: true };
  if (
    next.startedAt !== previous.startedAt ||
    (previous.lastProgressAt !== null &&
      next.lastProgressAt !== null &&
      Date.parse(next.lastProgressAt) < Date.parse(previous.lastProgressAt))
  )
    return { observation: previous, uncertain: true, ignored: true };
  return { observation: next, uncertain: false, ignored: false };
}

export const STARTUP_STAGE_COPY: Record<StartupObservation['stage'], string> = {
  'workspace-preparation': '准备代码副本',
  'instance-create': '创建运行环境',
  'instance-start': '启动运行环境',
  'runtime-tools': '准备 Agent 工具',
  'environment-initialization': '初始化运行环境',
  'agent-bootstrap': '启动 Agent',
  completed: '启动已完成',
};
