// 项目行按 32px 树布局展示。失败项目仍可选中以进入恢复面板，只有折叠操作受限。
import type { ReactNode } from 'react';
import { ChevronDown, Folder } from 'lucide-react';
import type { ProjectGroup } from '@/types/domain';

export interface ProjectGroupHeaderProps {
  projectId: string;
  projectName: string;
  taskCount: number;
  cloneStatus: ProjectGroup['cloneStatus'];
  selected: boolean;
  onSelect: (projectId: string) => void;
  /** 折叠态由 store.taskListFolds 经 selectProjectTaskTree 派生。 */
  collapsed: boolean;
  /** 点折叠箭头：只切折叠，⛔ 不连带选中项目——两个是不同的动作。 */
  onToggleCollapse: (projectId: string) => void;
  /** 点「⋯」：由 container 记下 openMenuProjectId。 */
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
  collapsed,
  onToggleCollapse,
  menuSlot,
}: ProjectGroupHeaderProps) {
  const failed = cloneStatus === 'failed';

  return (
    <div
      data-testid="project-group-header"
      data-project-group={projectId}
      data-variant={failed ? 'cloneFailed' : 'normal'}
      className={
        'group/project relative flex h-8 items-center rounded-md pl-1.5 pr-1 ' +
        (selected
          ? 'bg-[var(--v2-fill-selected)] before:absolute before:left-0 before:top-2 before:h-4 before:w-0.5 before:rounded-[1px] before:bg-foreground'
          : 'hover:bg-[var(--v2-fill)]')
      }
    >
      <button
        type="button"
        aria-label={collapsed ? '展开分组' : '收起分组'}
        title={`${collapsed ? '展开' : '收起'} ${projectName}`}
        aria-expanded={!collapsed}
        data-testid="project-group-toggle"
        className="inline-grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:[box-shadow:var(--v2-focus-ring-inset)] aria-disabled:cursor-not-allowed aria-disabled:text-[var(--v2-foreground-disabled)] aria-disabled:hover:text-[var(--v2-foreground-disabled)]"
        aria-disabled={cloneStatus !== 'ready'}
        aria-describedby={cloneStatus !== 'ready' ? `project-fold-reason-${projectId}` : undefined}
        onClick={() => {
          if (cloneStatus === 'ready') onToggleCollapse(projectId);
        }}
      >
        <ChevronDown
          aria-hidden="true"
          className={'size-4 transition-transform' + (collapsed ? ' -rotate-90' : '')}
        />
      </button>
      {cloneStatus !== 'ready' && (
        <span className="sr-only" id={`project-fold-reason-${projectId}`}>
          {cloneStatus === 'cloning'
            ? '项目正在克隆，任务列表暂不能展开'
            : '项目克隆失败，先重试克隆或改为空项目'}
        </span>
      )}
      <button
        type="button"
        aria-current={selected || undefined}
        aria-live="polite"
        aria-label={`${projectName}${cloneStatus === 'cloning' ? '，克隆中' : failed ? '，克隆失败' : ''}，${String(taskCount)} 个任务`}
        className="ml-0.5 flex h-full min-w-0 flex-1 items-center gap-2 pr-1 text-left text-sm font-medium leading-5 text-foreground after:absolute after:inset-y-0 after:left-7 after:right-0 after:rounded-md focus-visible:[box-shadow:none] focus-visible:after:[box-shadow:var(--v2-focus-ring-inset)]"
        onClick={() => {
          onSelect(projectId);
        }}
      >
        <Folder aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{projectName}</span>
        {cloneStatus === 'cloning' && (
          <span className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full bg-[var(--v2-status-warn-subtle-bg)] px-2 text-xs font-medium leading-4 text-warning">
            克隆中
          </span>
        )}
        {failed && (
          <span className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full bg-[var(--v2-status-fail-subtle-bg)] px-2 text-xs font-medium leading-4 text-error">
            克隆失败
          </span>
        )}
        <span
          className={
            'shrink-0 text-xs font-normal leading-4 tabular-nums text-muted-foreground transition-opacity ' +
            (menuSlot
              ? 'group-hover/project:opacity-0 group-focus-within/project:opacity-0 group-has-[[data-state=open]]/project:opacity-0 '
              : '') +
            (selected && menuSlot ? 'opacity-0' : '')
          }
          data-testid="project-group-count"
        >
          {taskCount}
        </span>
      </button>

      {menuSlot && (
        <div
          className={
            'absolute right-1 top-1 z-10 size-6 transition-opacity group-hover/project:opacity-100 group-focus-within/project:opacity-100 has-[[data-state=open]]:opacity-100 [&>button]:size-6 [&>button]:p-0 ' +
            (selected ? 'opacity-100' : 'opacity-0')
          }
        >
          {menuSlot}
        </div>
      )}
    </div>
  );
}
