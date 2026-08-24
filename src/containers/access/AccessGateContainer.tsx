'use client';
// 全局解锁门（11 §3.1）：唯一 view↔hook 粘合点。锁定时在应用之上浮出解锁表单，
// 解锁成功由 hook 清锁并 invalidate 查询触发重试；未启用口令（dev）时零渲染开销。
import type { ReactNode } from 'react';
import { useAccessGate } from '@/hooks/access/useAccessGate';
import { UnlockFormView } from '@/views/access/UnlockForm.view';

export function AccessGateContainer({ children }: { children: ReactNode }) {
  const { locked, reason, submitting, errorMessage, submit } = useAccessGate();

  return (
    <>
      {children}
      {locked && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="访问口令"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        >
          <UnlockFormView
            reason={reason}
            submitting={submitting}
            errorMessage={errorMessage}
            onSubmit={submit}
          />
        </div>
      )}
    </>
  );
}
