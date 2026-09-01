// 项目分组组头（F21-6 §3）：`📁 ProjectName (N) ⋯`，两个 variant。纯展示、props 驱动、零副作用。
//
// 两个 variant 由 `cloneStatus` 派生，不额外开一个 prop（多一个入参就多一种"两处不一致"的可能）：
//   · `normal`      —— `📁 ProjectName · N ⋯`（cloning 另带黄色徽标）
//   · `cloneFailed` —— `🔴 📁 ProjectName ⚠️ 克隆失败 ⋯`（产品 P21-6 §9）
//
// ⚠️ **failed 项目在本实现里仍然可以选中**，与 §5/§6 那条「failed 不可选为当前项目、
// 点组头仅展开」不一致 —— 这是**刻意的**，理由回填进了文档：`ProjectRecoveryContainer`
// （§10.2 A 裁决明写"恢复面板留在原地不动"）正是靠"选中失败项目"才渲染得出来的。
// 把选中挡掉，P0-1 那条通路（刷新/切走再回来仍能触达 retry-clone）当场断掉。
//
// 「⋯」的菜单本体是 `ProjectGroupMenu.view`，由 container 决定开合后经 `menuSlot` 插进来
// （views 不持有开合状态；组头只负责给它一个定位锚点）。
import type { ReactNode } from 'react';
import type { ProjectGroup } from '@/types/domain';

export interface ProjectGroupHeaderProps {
  projectId: string;
  projectName: string;
  taskCount: number;
  cloneStatus: ProjectGroup['cloneStatus'];
  selected: boolean;
  onSelect: (projectId: string) => void;
  /** 点「⋯」：由 container 记下 openMenuProjectId。 */
  onOpenMenu: (projectId: string) => void;
  /** 菜单本体（打开时由 container 传入；关闭时为 undefined）。 */
  menuSlot?: ReactNode;
}

export function ProjectGroupHeaderView({
  projectId,
  projectName,
  taskCount,
  cloneStatus,
  selected,
  onSelect,
  onOpenMenu,
  menuSlot,
}: ProjectGroupHeaderProps) {
  const failed = cloneStatus === 'failed';

  return (
    <div
      data-testid="project-group-header"
      data-variant={failed ? 'cloneFailed' : 'normal'}
      className="relative flex items-center gap-1"
    >
      <button
        type="button"
        aria-current={selected || undefined}
        className={
          'flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-muted ' +
          (selected ? 'bg-muted text-foreground' : '')
        }
        onClick={() => {
          onSelect(projectId);
        }}
      >
        {failed && <span aria-hidden="true">🔴</span>}
        <span aria-hidden="true">📁</span>
        <span className="truncate">{projectName}</span>
        <span className="text-muted-foreground">· {taskCount}</span>
        {cloneStatus === 'cloning' && (
          <span className="rounded bg-yellow-500/15 px-1 text-[10px] text-yellow-300">克隆中</span>
        )}
        {failed && (
          <span className="rounded bg-red-500/15 px-1 text-[10px] text-red-300">⚠️ 克隆失败</span>
        )}
      </button>

      {/* 「⋯」：项目的管理入口。在它之前，删除项目在界面上根本够不着（§10.1）。 */}
      {/*
        ⚠️ 无障碍名**刻意不含项目名**（只放进 `title`）。含了的话，
        `getByRole('button', { name: /项目名/ })` 会同时命中组头按钮与这个「⋯」，
        全仓（含 e2e）按项目名点项目的地方会一起变成 strict-mode 二义匹配。
        菜单本体（`ProjectGroupMenu.view` 的 `role="menu"`）带着项目名，上下文不丢。
      */}
      <button
        type="button"
        aria-label="项目菜单"
        title={`${projectName} 的项目菜单`}
        aria-haspopup="menu"
        aria-expanded={menuSlot !== undefined}
        data-testid="project-group-menu-trigger"
        className="shrink-0 rounded px-1 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => {
          onOpenMenu(projectId);
        }}
      >
        ⋯
      </button>

      {menuSlot}
    </div>
  );
}
