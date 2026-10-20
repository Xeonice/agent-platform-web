'use client';
import { useMemo, type ReactNode } from 'react';
import {
  InstanceUpgradeContext,
  InstanceIdentityContext,
  useInstanceUpgrade,
} from '@/hooks/system/useInstanceUpgrade';
export function InstanceUpgradeProviderContainer({ children }: { children: ReactNode }) {
  const controller = useInstanceUpgrade();
  const instanceId = controller.observation?.snapshot?.instanceId ?? null;
  const userScope = controller.observation?.snapshot?.userScope ?? null;
  const identity = useMemo(
    () => (instanceId === null || userScope === null ? null : { instanceId, userScope }),
    [instanceId, userScope],
  );
  return (
    <InstanceUpgradeContext.Provider value={controller}>
      <InstanceIdentityContext.Provider value={identity}>
        {children}
      </InstanceIdentityContext.Provider>
    </InstanceUpgradeContext.Provider>
  );
}
