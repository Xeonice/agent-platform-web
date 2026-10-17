import type { StartupObservation } from '@/types/ws-protocol';

interface PendingLifecycle {
  pendingLifecycleOperation?: 'start' | 'stop';
  pendingLifecycleSourceOperationId?: string;
}
/** An old source status is not proof that an admitted request has finished. */
export function inconclusiveLifecycleResult(
  previous: PendingLifecycle | undefined,
  next: { status: string; startupObservation?: StartupObservation },
): boolean {
  if (previous?.pendingLifecycleOperation === 'stop')
    return next.status === 'running' || next.status === 'idle';
  if (previous?.pendingLifecycleOperation !== 'start' || next.status !== 'stopped') return false;
  const observation = next.startupObservation;
  return (
    observation === undefined ||
    observation.operationId === previous.pendingLifecycleSourceOperationId ||
    observation.state === 'inflight' ||
    observation.state === 'unknown'
  );
}
