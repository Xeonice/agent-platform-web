'use client';
// 已保留卷容器（F21-6 §3.3）：hook ↔ view 的唯一粘合点（07 §2）。
// 自己不做任何判断——文案/排序/取整在 `lib/project/retainedVolumeModel`（经 hook 转接）。
import { useRetainedVolumes } from '@/hooks/project/useRetainedVolumes';
import { RetainedVolumesPanelView } from '@/views/project/RetainedVolumesPanel.view';

export interface RetainedVolumesContainerProps {
  projectId: string;
  projectName: string;
}

export function RetainedVolumesContainer({
  projectId,
  projectName,
}: RetainedVolumesContainerProps) {
  const {
    rows,
    totals,
    loading,
    loadErrorMessage,
    actionErrorMessage,
    deletingId,
    remove,
    archiveUrl,
  } = useRetainedVolumes(projectId);

  return (
    <RetainedVolumesPanelView
      projectName={projectName}
      rows={rows}
      totals={totals}
      loading={loading}
      {...(loadErrorMessage === undefined ? {} : { loadErrorMessage })}
      {...(actionErrorMessage === undefined ? {} : { actionErrorMessage })}
      deletingId={deletingId}
      archiveUrl={archiveUrl}
      onDelete={remove}
    />
  );
}
