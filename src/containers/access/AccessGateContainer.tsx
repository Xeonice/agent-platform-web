'use client';
import type { ReactNode } from 'react';
import { useAccessGate } from '@/hooks/access/useAccessGate';
import { UnlockFormView } from '@/views/access/UnlockForm.view';

export function AccessGateContainer({
  children,
  forceLocked = false,
}: {
  children?: ReactNode;
  forceLocked?: boolean;
}) {
  const { locked, submitting, errorMessage, lockedForMinutes, submit } = useAccessGate();
  if (!locked && !forceLocked) return <>{children}</>;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background p-6 text-foreground">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span
          aria-hidden="true"
          className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
        >
          A
        </span>
        Agent 管理平台{' '}
        <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
          本机
        </span>
      </div>
      <div role="dialog" aria-modal="true" aria-label="访问口令" className="w-full max-w-sm">
        <UnlockFormView
          submitting={submitting}
          errorMessage={errorMessage}
          lockedForMinutes={lockedForMinutes}
          onSubmit={submit}
        />
      </div>
    </main>
  );
}
