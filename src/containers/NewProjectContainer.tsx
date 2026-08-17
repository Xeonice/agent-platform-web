'use client';
// 新建项目编排（10 §7）：表单 → POST(202) → 消费 clone_progress 进度 → done 打开 / failed 重试或转空。
// 唯一 view↔hooks 粘合点；副作用在 mutation（hook）。/events 由 WorkbenchContainer 全局订阅驱动 store。
import { useState } from 'react';
import { useCreateProject, describeCreateProjectError } from '@/hooks/useProjects';
import { useProjectClone } from '@/hooks/useProjectClone';
import { useProjectRecovery } from '@/hooks/useProjectRecovery';
import { useReportUnauthorized } from '@/hooks/useAccessGate';
import { useAppStore } from '@/stores';
import { NewProjectFormView } from '@/views/project/NewProjectForm.view';
import { CloneProgressView } from '@/views/project/CloneProgress.view';
import type { CreateProjectInput, ProjectCloneState } from '@/types/project';

export interface NewProjectContainerProps {
  /** 项目就绪（clone done / 转空成功）→ 选中并进入建沙箱流。 */
  onProjectReady: (projectId: string) => void;
  onCancel: () => void;
}

/** 依 cloneStatus 决定种子进度：ready（空项目/秒完成）→ done，否则 cloning。 */
function seedFor(cloneStatus: string): ProjectCloneState {
  return cloneStatus === 'ready' ? { phase: 'done' } : { phase: 'cloning' };
}

export function NewProjectContainer({ onProjectReady, onCancel }: NewProjectContainerProps) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');

  const createProject = useCreateProject();
  const { reportRestError } = useReportUnauthorized();
  const setCloneProgress = useAppStore((s) => s.setCloneProgress);
  const clearCloneProgress = useAppStore((s) => s.clearCloneProgress);

  const clone = useProjectClone(projectId);
  // retry/convert 复用统一恢复逻辑（回退 + 可见错误，P0-2）；errorCode 取自 store 的失败态。
  const recovery = useProjectRecovery({
    projectId,
    errorCode: clone.state?.errorCode,
    onConverted: onProjectReady,
  });

  const handleSubmit = (input: CreateProjectInput): void => {
    createProject.mutate(input, {
      onSuccess: (project) => {
        setProjectName(project.name);
        setCloneProgress(project.id, seedFor(project.cloneStatus)); // 立即展示，不等首个事件
        setProjectId(project.id);
      },
      onError: (error) => {
        reportRestError(error);
      },
    });
  };

  const handleDone = (): void => {
    if (projectId === null) return;
    clearCloneProgress(projectId);
    onProjectReady(projectId);
  };

  // 尚未创建：展示表单（409 名称重复等给友好文案）。
  if (projectId === null || clone.state === null) {
    return (
      <NewProjectFormView
        submitting={createProject.isPending}
        errorMessage={describeCreateProjectError(createProject.error)}
        onSubmit={handleSubmit}
        onCancel={onCancel}
      />
    );
  }

  return (
    <CloneProgressView
      projectName={projectName}
      phase={clone.state.phase}
      percent={clone.percent}
      detailLabel={clone.detailLabel}
      guidanceMessage={clone.guidance?.message}
      canRetry={clone.guidance?.canRetry}
      needsCredentials={clone.guidance?.needsCredentials}
      busy={recovery.busy}
      actionError={recovery.actionError ?? undefined}
      onRetry={recovery.retry}
      onConvertToEmpty={recovery.convertToEmpty}
      onDone={handleDone}
      onCancel={onCancel}
    />
  );
}
