'use client';
// 本页装配同页成果对话框，保持设置页位置并恢复清理入口焦点。
import { useRef, useState } from 'react';
import { AccessGateContainer } from '@/containers/access/AccessGateContainer';
import { AuditStreamContainer } from '@/containers/system/AuditStreamContainer';
import { SystemStatusContainer } from '@/containers/system/SystemStatusContainer';
import { RetainedVolumesContainer } from '@/containers/project/RetainedVolumesContainer';

export default function SystemStatusPage() {
  const [showRetained, setShowRetained] = useState(false);
  const cleanupRef = useRef<HTMLButtonElement>(null);
  return (
    <AccessGateContainer>
      <div
        className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2"
        data-testid="system-status-grid"
      >
        <SystemStatusContainer
          cleanupTriggerRef={cleanupRef}
          onCleanupRetained={() => {
            setShowRetained(true);
          }}
        />
        <div className="lg:col-span-2" data-testid="system-status-audit-row">
          <AuditStreamContainer />
        </div>
      </div>
      {showRetained ? (
        <RetainedVolumesContainer
          projectId={null}
          projectName="全部项目"
          onClose={() => {
            setShowRetained(false);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            cleanupRef.current?.focus();
          }}
        />
      ) : null}
    </AccessGateContainer>
  );
}
