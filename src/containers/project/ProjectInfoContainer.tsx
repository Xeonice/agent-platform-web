'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSyncProject } from '@/hooks/project/useProjectBranches';
import { ProjectInfoBarView } from '@/views/project/ProjectInfoBar.view';
import type { ProjectDto } from '@/types/project';
export function ProjectInfoContainer({ project }: { project: ProjectDto }) {
  const router = useRouter();
  const sync = useSyncProject();
  const [open, setOpen] = useState(false);
  const [openWithoutFocus, setOpenWithoutFocus] = useState(false);
  useEffect(() => {
    if (sync.errorMessage) {
      setOpenWithoutFocus(true);
      setOpen(true);
    }
  }, [sync.errorMessage]);
  return (
    <ProjectInfoBarView
      projectName={project.name}
      sourceType={project.sourceType}
      repoUrl={project.repoUrl}
      repoBranch={project.repoBranch}
      baselineSizeBytes={project.baselineSizeBytes}
      updatedAt={project.updatedAt}
      createdAt={project.createdAt}
      canSync={project.cloneStatus === 'ready'}
      syncing={sync.isPending}
      syncErrorMessage={sync.errorMessage}
      syncNeedsCredentials={sync.needsCredentials}
      syncSucceeded={sync.isSuccess}
      open={open}
      openWithoutFocus={openWithoutFocus}
      onOpenChange={(next) => {
        setOpenWithoutFocus(false);
        setOpen(next);
      }}
      onSync={() => {
        sync.sync(project.id);
      }}
      onConfigureCredentials={() => {
        router.push('/settings/credentials?section=git');
      }}
    />
  );
}
