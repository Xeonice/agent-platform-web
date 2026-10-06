'use client';
import { useEffect } from 'react';
import { useProjectClone } from '@/hooks/project/useProjectClone';
import { useAppStore } from '@/stores';
import { CloneProgressView } from '@/views/project/CloneProgress.view';
import type { ProjectDto } from '@/types/project';
export function ProjectCloneContainer({ project }: { project: ProjectDto; onBack: () => void }) {
  const clone = useProjectClone(project.id);
  useEffect(() => {
    if (!useAppStore.getState().projectClones[project.id])
      useAppStore.getState().setCloneProgress(project.id, { phase: 'cloning' });
  }, [project.id, project.createdAt]);
  return (
    <CloneProgressView
      mainArea
      projectName={project.name}
      phase={clone.state?.phase ?? 'cloning'}
      percent={clone.percent}
      detailLabel={clone.detailLabel}
      elapsedLabel={clone.elapsedLabel}
    />
  );
}
