'use client';
// 项目详情 / 删除确认容器（F21-6 §10）：hook ↔ view 的唯一粘合点（07 §2）。
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
//
// ⚠️ **2026-09-14 拆分**：本容器此前渲染 `ProjectMenuPanel` —— 详情 + 两个跳转入口 +
// 删除按钮混在一个面板里。现在两个跳转入口提到了 ⋯ 菜单（一级直达），删除入口也只留
// 菜单那一个，本容器只剩**详情**与**删除确认**两个视图。
// ⛔ 不要在详情视图里再加 [删除项目…]：那正是拆分前的病（同一个不可逆动作两个入口）。
import { useState } from 'react';
import { useDeleteProject, describeProjectActionError } from '@/hooks/project/useProjects';
import { useProjectRunningTasks } from '@/hooks/project/useProjectRunningTasks';
import { useRetainedVolumes } from '@/hooks/project/useRetainedVolumes';
import { useAutomations } from '@/hooks/automation/useAutomations';
import { ProjectDetailPanelView } from '@/views/project/ProjectDetailPanel.view';
import { DeleteProjectConfirmView } from '@/views/project/DeleteProjectConfirm.view';
import type { ProjectCloneStatus } from '@/types/project';

export interface ProjectMenuContainerProps {
  projectId: string;
  projectName: string;
  cloneStatus: ProjectCloneStatus;
  taskCount: number;
  createdAt: string;
  /** 从组头菜单的 [删除项目…] 进入时直接落在确认视图上（同一个确认组件，不另开一处）。 */
  initialConfirmingDelete?: boolean;
  /** 删除成功：关面板 + 上下文回落由 container 的宿主负责。 */
  onDeleted: (projectId: string) => void;
  /** 取消删除 = 关掉这个面板（⛔ 与 `onDeleted` 分开：那个还带着"项目没了"的语义）。 */
  onClose: () => void;
}

export function ProjectMenuContainer({
  projectId,
  projectName,
  cloneStatus,
  taskCount,
  createdAt,
  initialConfirmingDelete = false,
  onDeleted,
  onClose,
}: ProjectMenuContainerProps) {
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | undefined>(undefined);
  const deleteProject = useDeleteProject();
  const runningTaskCount = useProjectRunningTasks(projectId);

  /*
   * 摘要计数。⚠️ 只在**详情视图**要，删除确认视图不需要 —— 但 hook 不能条件调用，
   * 所以照常订阅；两者都走各自面板已经在用的那个 query key，⛔ 不新增端点。
   * ⚠️ **加载中必须传 `undefined` 而不是 0**：报 0 会让用户以为自己什么都没留下，
   * 而实际可能只是还没加载完（view 那边渲染成「—」）。
   */
  const retained = useRetainedVolumes(projectId);
  const automations = useAutomations(projectId);

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

  if (initialConfirmingDelete) {
    return (
      <DeleteProjectConfirmView
        projectName={projectName}
        taskCount={taskCount}
        runningTaskCount={runningTaskCount}
        cloning={cloneStatus === 'cloning'}
        busy={deleteProject.isPending}
        {...(deleteErrorMessage === undefined ? {} : { errorMessage: deleteErrorMessage })}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          // 取消 = 关掉这个面板。⛔ 不回退到详情视图：用户是从 ⋯ 菜单直奔删除来的，
          // 把他丢进一个没点过的详情页是答非所问。
          onClose();
        }}
      />
    );
  }

  return (
    <ProjectDetailPanelView
      cloneStatus={cloneStatus}
      taskCount={taskCount}
      createdAt={createdAt}
      {...(retained.loading ? {} : { retainedCount: retained.rows.length })}
      {...(automations.loading ? {} : { automationCount: automations.dtos.length })}
    />
  );
}
