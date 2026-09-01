'use client';
// 项目菜单侧弹层容器（F21-6 §10）：hook ↔ view 的唯一粘合点（07 §2）。
//
// 它承载的是这一期的**真正理由**：`DELETE /api/projects/:id` 端点一直都在、级联语义
// 早就定义好了，而用户在界面上够不着——唯一的删除途径是自己拼 URL 打 API，没有二次确认、
// 没有级联后果提示、没有运行中任务警示（§10.1）。
//
// ⚠️ 两条纪律写在这里，改动前先读：
//  ① **运行中任务数读真数据**（§10.6 第 3 条）：`useProjectRunningTasks` 走的是左侧树
//     同一份沙箱缓存。⛔ 不许退回"可能有正在运行的任务"这种永远正确因而永远没用的话。
//  ② **删除失败不静默关闭**（§10.7 集成 ③）：后端 409（有运行中任务等）时弹层留在原地
//     并把原因说出来。把 409 处理成"关掉就完了"，用户会以为删成功了，而树上那一项还在。
import { useState } from 'react';
import { useDeleteProject, describeProjectActionError } from '@/hooks/project/useProjects';
import { useProjectRunningTasks } from '@/hooks/project/useProjectRunningTasks';
import { ProjectMenuPanelView } from '@/views/project/ProjectMenuPanel.view';
import type { ProjectCloneStatus } from '@/types/project';

export interface ProjectMenuContainerProps {
  projectId: string;
  projectName: string;
  cloneStatus: ProjectCloneStatus;
  taskCount: number;
  createdAt: string;
  /** 从组头菜单的 [删除项目…] 进入时直接落在确认视图上（同一个确认组件，不另开一处）。 */
  initialConfirmingDelete?: boolean;
  onOpenRetainedVolumes: () => void;
  onOpenAutomations: () => void;
  /** 删除成功：关面板 + 上下文回落由 container 的宿主负责。 */
  onDeleted: (projectId: string) => void;
}

export function ProjectMenuContainer({
  projectId,
  projectName,
  cloneStatus,
  taskCount,
  createdAt,
  initialConfirmingDelete = false,
  onOpenRetainedVolumes,
  onOpenAutomations,
  onDeleted,
}: ProjectMenuContainerProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(initialConfirmingDelete);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | undefined>(undefined);
  const deleteProject = useDeleteProject();
  const runningTaskCount = useProjectRunningTasks(projectId);

  const handleConfirmDelete = (): void => {
    setDeleteErrorMessage(undefined);
    deleteProject.mutate(projectId, {
      onSuccess: () => {
        onDeleted(projectId);
      },
      onError: (error) => {
        // ⛔ 不关闭、不回退到详情视图：用户要在**看得到刚才那句后果文案**的地方读到失败原因。
        setDeleteErrorMessage(describeProjectActionError(error));
      },
    });
  };

  return (
    <ProjectMenuPanelView
      projectName={projectName}
      cloneStatus={cloneStatus}
      taskCount={taskCount}
      createdAt={createdAt}
      runningTaskCount={runningTaskCount}
      confirmingDelete={confirmingDelete}
      deleting={deleteProject.isPending}
      {...(deleteErrorMessage === undefined ? {} : { deleteErrorMessage })}
      onRequestDelete={() => {
        setDeleteErrorMessage(undefined);
        setConfirmingDelete(true);
      }}
      onCancelDelete={() => {
        setDeleteErrorMessage(undefined);
        setConfirmingDelete(false);
      }}
      onConfirmDelete={handleConfirmDelete}
      onOpenRetainedVolumes={onOpenRetainedVolumes}
      onOpenAutomations={onOpenAutomations}
    />
  );
}
