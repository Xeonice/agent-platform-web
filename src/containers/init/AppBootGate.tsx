'use client';
import { useEffect, type ReactNode } from 'react';
import { useInitGate } from '@/hooks/system/useInitGate';
import { useReportUnauthorized, isAccessDenied } from '@/hooks/access/useAccessGate';
import { useAppStore } from '@/stores';
import { AccessGateContainer } from '@/containers/access/AccessGateContainer';
import { InitWizardContainer } from '@/containers/init/InitWizardContainer';

export function AppBootGate({ children }: { children: ReactNode }) {
  const gate = useInitGate();
  const locked = useAppStore((s) => s.accessLocked);
  const { reportRestError } = useReportUnauthorized();

  // ④ 401/口令门拒绝 → 置锁，`AccessGateContainer` 浮出解锁框。
  useEffect(() => {
    if (gate.error !== null) reportRestError(gate.error);
  }, [gate.error, reportRestError]);

  if (locked || isAccessDenied(gate.error)) return <AccessGateContainer forceLocked />;

  // ③ 判定没回来之前**什么都不挂**（工作台与向导都不挂）。
  if (gate.isPending) {
    return (
      <div
        role="status"
        data-testid="app-boot-skeleton"
        className="flex min-h-screen items-center justify-center text-sm text-muted-foreground"
      >
        正在检查平台初始化状态…
      </div>
    );
  }

  // ① `initialized !== true` ⇒ **只有向导**。⛔ 不要在这里 `<>{children}{wizard}</>`。
  //    ⚠️ 判据写成 `=== false` 而不是 `!== true` 是刻意的：`gate.data` 为 undefined 的情况
  //    （④ 的失败路径）走下面的放行，不掉进向导。
  if (gate.data?.initialized === false) {
    return <InitWizardContainer />;
  }

  return <>{children}</>;
}
