// 项目菜单侧弹层的内容（F21-6 §3 / §10.5）。纯展示、props 驱动、零副作用。
//
// ⚠️ **外壳复用 `views/common/ModalShell.view`**（§10.5）：overlay / Esc / 焦点三件事由它
// 与 container 的 `useEscapeKey` + `useModalFocus` 负责，⛔ 本文件不再写一遍。本组件只出内容。
//
// 面板内两个视图（详情 ⇄ 删除确认）是**切换**，不是第二层弹层（P20 §8.4 modal 不堆叠）。
//
// 🎁 已保留卷 / ⚙️ 自动化规则两个入口本轮**从 `ProjectInfoBar` 搬到这里**（§10.2 C）：
// 它们本来就是项目级管理动作，只读条上那个位置是 `ProjectMenuPanel` 不存在时的权宜之计。
// 只读条自此回到纯只读。
import type { ProjectCloneStatus } from '@/types/project';
import { Button } from '@/components/ui/button';
import { ProjectMetaSectionView } from '@/views/project/ProjectMetaSection.view';
import { ProjectActionsView } from '@/views/project/ProjectActions.view';
import { DeleteProjectConfirmView } from '@/views/project/DeleteProjectConfirm.view';

export interface ProjectMenuPanelProps {
  projectName: string;
  cloneStatus: ProjectCloneStatus;
  taskCount: number;
  createdAt: string;
  /** 运行中 Task 数（真数据；删除确认的警示读它）。 */
  runningTaskCount: number;
  /** true ⇒ 面板切到删除确认视图。 */
  confirmingDelete: boolean;
  deleting: boolean;
  deleteErrorMessage?: string;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onOpenRetainedVolumes: () => void;
  onOpenAutomations: () => void;
}

export function ProjectMenuPanelView({
  projectName,
  cloneStatus,
  taskCount,
  createdAt,
  runningTaskCount,
  confirmingDelete,
  deleting,
  deleteErrorMessage,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onOpenRetainedVolumes,
  onOpenAutomations,
}: ProjectMenuPanelProps) {
  return (
    <div data-testid="project-menu-panel" className="flex flex-col">
      <ProjectMetaSectionView
        projectName={projectName}
        cloneStatus={cloneStatus}
        taskCount={taskCount}
        createdAt={createdAt}
      />

      {confirmingDelete ? (
        <DeleteProjectConfirmView
          projectName={projectName}
          taskCount={taskCount}
          runningTaskCount={runningTaskCount}
          cloning={cloneStatus === 'cloning'}
          busy={deleting}
          {...(deleteErrorMessage === undefined ? {} : { errorMessage: deleteErrorMessage })}
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
      ) : (
        <>
          <div className="flex flex-col gap-2 border-b border-border px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              data-testid="open-retained-volumes"
              onClick={() => {
                onOpenRetainedVolumes();
              }}
            >
              🎁 已保留卷
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              data-testid="open-automations"
              onClick={() => {
                onOpenAutomations();
              }}
            >
              ⚙️ 自动化规则
            </Button>
          </div>
          <ProjectActionsView busy={deleting} onRequestDelete={onRequestDelete} />
        </>
      )}
    </div>
  );
}
