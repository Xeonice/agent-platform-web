'use client';
import { useState } from 'react';
import {
  focusRetainedDelete,
  useRetainedVolumeFocus,
} from '@/hooks/workbench/useWorkbenchObjectFocus';
import { useRetainedVolumes } from '@/hooks/project/useRetainedVolumes';
import { useProjects } from '@/hooks/project/useProjects';
import { useAppStore } from '@/stores';
import { RetainedVolumesPanelView } from '@/views/project/RetainedVolumesPanel.view';
import { AppDialogView } from '@/views/common/AppDialog.view';

export interface RetainedVolumesContainerProps {
  projectId: string | null;
  projectName: string;
  onClose?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}
export function RetainedVolumesContainer({
  projectId,
  projectName,
  onClose,
  onCloseAutoFocus,
}: RetainedVolumesContainerProps) {
  const [scope, setScope] = useState(projectId);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const retained = useRetainedVolumes(scope);
  const projects = useProjects();
  const focusSandboxId = useAppStore((state) => state.retainedVolumeFocusSandboxId);
  const confirmingRow = retained.rows.find((row) => row.id === confirmingId) ?? null;
  const scopedName = projects.data?.find((project) => project.id === scope)?.name ?? projectName;
  useRetainedVolumeFocus(retained.rows, focusSandboxId);
  const cancel = () => {
    const id = confirmingId;
    setConfirmingId(null);
    focusRetainedDelete(id);
  };
  const body = (
    <RetainedVolumesPanelView
      {...retained}
      projectName={scopedName}
      projects={projects.data ?? []}
      scope={scope}
      allowScope={projectId === null}
      focusSandboxId={focusSandboxId}
      confirmingRow={confirmingRow}
      projectTaskCount={
        projects.data?.find((project) => project.id === confirmingRow?.projectId)?.taskCount ?? 0
      }
      onScopeChange={setScope}
      onRequestDelete={setConfirmingId}
      onCancelDelete={cancel}
      onRetry={retained.retry}
      onDelete={(id) => {
        void retained
          .remove(id)
          .then(() => {
            setConfirmingId(null);
          })
          .catch(() => undefined);
      }}
    />
  );
  if (onClose === undefined) return body;
  return (
    <AppDialogView
      title={confirmingRow ? `删除成果「${confirmingRow.originText}」？` : '保留下来的成果'}
      subtitle={scope === null ? '全部项目' : `在 ${scopedName} 中`}
      onClose={confirmingRow !== null ? cancel : onClose}
      onCloseAutoFocus={onCloseAutoFocus}
      busy={retained.deletingId !== null}
      testId="modal-retained-volumes"
    >
      {body}
    </AppDialogView>
  );
}
