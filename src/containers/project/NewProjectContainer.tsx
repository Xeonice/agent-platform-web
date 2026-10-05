'use client';
// 新建项目编排（10 §7）：表单 → POST(202) → 消费 clone_progress 进度 → done 打开 / failed 重试或转空。
// 唯一 view↔hooks 粘合点；副作用在 mutation（hook）。/events 由 WorkbenchContainer 全局订阅驱动 store。
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useCreateProject,
  describeCreateProjectError,
  useProjects,
} from '@/hooks/project/useProjects';
import { useProjectClone } from '@/hooks/project/useProjectClone';
import { useProjectRecovery } from '@/hooks/project/useProjectRecovery';
import { useReportUnauthorized } from '@/hooks/access/useAccessGate';
import { useAppStore } from '@/stores';
import { NewProjectFormView } from '@/views/project/NewProjectForm.view';
import { CloneProgressView } from '@/views/project/CloneProgress.view';
import type { CreateProjectInput, ProjectCloneState, ProjectSourceType } from '@/types/project';

export interface NewProjectContainerProps {
  initialSourceType?: ProjectSourceType;
  focusRepository?: boolean;
  /** 项目就绪（clone done / 转空成功）→ 选中并进入建沙箱流。 */
  onProjectReady: (projectId: string) => void;
  onProjectCreated?: (projectId: string) => void;
  onCancel: () => void;
  onBusyChange?: (busy: boolean) => void;
}

/** 依 cloneStatus 决定种子进度：ready（空项目/秒完成）→ done，否则 cloning。 */
function seedFor(cloneStatus: string): ProjectCloneState {
  return cloneStatus === 'ready' ? { phase: 'done' } : { phase: 'cloning' };
}

export function NewProjectContainer({
  onProjectReady,
  onProjectCreated,
  onCancel,
  onBusyChange,
  initialSourceType = 'git',
  focusRepository = false,
}: NewProjectContainerProps) {
  const router = useRouter();
  const projects = useProjects();
  let largest = 0n;
  for (const project of projects.data ?? []) {
    const match = /^未命名项目 ([1-9][0-9]*)$/.exec(project.name);
    if (match?.[1] !== undefined) {
      const value = BigInt(match[1]);
      if (value > largest) largest = value;
    }
  }
  const suggestedName = `未命名项目 ${String(largest + 1n)}`;
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  // clone 权限失败回程用：仅内存暂存本次提交的 git URL（不落地、不回读，产品红线）。
  const [repoUrl, setRepoUrl] = useState<string | undefined>(undefined);

  const createProject = useCreateProject();
  const { reportRestError } = useReportUnauthorized();
  const setCloneProgress = useAppStore((s) => s.setCloneProgress);
  const clearCloneProgress = useAppStore((s) => s.clearCloneProgress);
  const setPendingProjectCreate = useAppStore((s) => s.setPendingProjectCreate);

  const clone = useProjectClone(projectId);
  // retry/convert 复用统一恢复逻辑（回退 + 可见错误，P0-2）；errorCode 取自 store 的失败态。
  const recovery = useProjectRecovery({
    projectId,
    errorCode: clone.state?.errorCode,
    onConverted: onProjectReady,
  });

  useEffect(() => {
    onBusyChange?.(createProject.isPending || recovery.busy);
  }, [createProject.isPending, recovery.busy, onBusyChange]);

  const handleSubmit = (input: CreateProjectInput): void => {
    setRepoUrl(input.sourceType === 'git' ? input.repoUrl : undefined);
    createProject.mutate(input, {
      onSuccess: (project) => {
        setProjectName(project.name);
        setCloneProgress(project.id, seedFor(project.cloneStatus)); // 立即展示，不等首个事件
        setProjectId(project.id);
        if (project.cloneStatus === 'ready') onProjectReady(project.id);
        else onProjectCreated?.(project.id);
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

  // 权限类失败 → 携 pendingProjectCreate 跳凭证页（项目已落库，回程走 retry-clone，永不重新 create）。
  const handleConfigureCredentials = (): void => {
    if (projectId === null) return;
    setPendingProjectCreate({
      projectId,
      name: projectName,
      source: 'git',
      ...(repoUrl !== undefined && repoUrl !== '' ? { url: repoUrl } : {}),
    });
    router.push('/settings/credentials?section=git');
  };

  // 尚未创建：展示表单（409 名称重复等给友好文案）。
  if (projectId === null || clone.state === null) {
    return (
      <NewProjectFormView
        focusRepository={focusRepository}
        initialSourceType={initialSourceType}
        initialName={initialSourceType === 'empty' ? suggestedName : ''}
        suggestedEmptyName={suggestedName}
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
      elapsedLabel={clone.elapsedLabel}
      guidanceMessage={clone.guidance?.message}
      canRetry={clone.guidance?.canRetry}
      needsCredentials={clone.guidance?.needsCredentials}
      busy={recovery.busy}
      actionError={recovery.actionError ?? undefined}
      onRetry={() => {
        recovery.retry();
      }}
      onConvertToEmpty={() => {
        recovery.convertToEmpty();
      }}
      onConfigureCredentials={handleConfigureCredentials}
      onDone={handleDone}
      onCancel={onCancel}
    />
  );
}
