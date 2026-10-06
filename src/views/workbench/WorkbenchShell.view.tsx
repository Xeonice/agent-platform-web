import type { ReactNode } from 'react';
import type { ProjectGroup, TaskStatusFilter } from '@/types/domain';
import { AppSidebarView } from '@/views/workbench/AppSidebar.view';
import { WorkbenchHeaderView } from '@/views/workbench/WorkbenchHeader.view';
export type { ThemeChoice } from '@/views/workbench/AppSidebar.view';
import type { ThemeChoice } from '@/views/workbench/AppSidebar.view';

export interface WorkbenchShellProps {
  hideSidebar?: boolean;
  hideHeader?: boolean;
  onFind?: () => void;
  onShortcuts?: () => void;
  isLoading?: boolean;
  groups: ProjectGroup[];
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  waitingInputCount: number;
  healthLabel: string | null;
  terminalSlot: ReactNode;
  selectedTaskId?: string | null;
  selectedProjectId?: string | null;
  onSelectTask?: (taskId: string) => void;
  onSelectProject?: (projectId: string) => void;
  onNewProject?: () => void;
  onNewTask?: () => void;
  newTaskDisabledReason?: string;
  overlaySlot?: ReactNode;

  currentProjectName?: string | null;
  onLocateCurrentProject?: () => void;
  renderGroupMenu?: (projectId: string) => ReactNode;
  onToggleGroupCollapse?: (projectId: string) => void;

  searchQuery?: string;
  onSearchQueryChange?: (value: string) => void;
  statusFilter?: TaskStatusFilter;
  onStatusFilterChange?: (status: TaskStatusFilter) => void;
  hasNoFilterMatches?: boolean;
  systemStatusHref?: string;
  theme?: ThemeChoice;
  onThemeChange?: (theme: ThemeChoice) => void;
}

export function WorkbenchShellView({
  groups,
  waitingInputCount,
  healthLabel,
  terminalSlot,
  selectedTaskId = null,
  selectedProjectId = null,
  onSelectTask,
  onSelectProject,
  onNewProject,
  onNewTask,
  newTaskDisabledReason,
  overlaySlot,
  currentProjectName = null,
  renderGroupMenu,
  onToggleGroupCollapse,
  searchQuery = '',
  onSearchQueryChange,
  statusFilter = 'all',
  onStatusFilterChange,
  hasNoFilterMatches = false,
  systemStatusHref = '/settings/system',
  theme = 'system',
  onThemeChange,
  sidebarCollapsed = false,
  onToggleSidebar,
  hideSidebar = false,
  hideHeader = false,
  onFind,
  onShortcuts,
  isLoading = false,
}: WorkbenchShellProps) {
  const sidebarProps = {
    groups,
    waitingInputCount,
    selectedTaskId,
    selectedProjectId,
    onSelectTask,
    onSelectProject,
    onNewProject,
    onNewTask,
    renderGroupMenu,
    onToggleGroupCollapse,
    searchQuery,
    onSearchQueryChange,
    statusFilter,
    onStatusFilterChange,
    hasNoFilterMatches,
    systemStatusHref,
    theme,
    onThemeChange,
    sidebarCollapsed,
    onToggleSidebar,
    onFind,
    onShortcuts,
    isLoading,
  };
  return (
    <div className="flex h-full bg-background text-foreground">
      <a
        href="#workbench-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-card focus:p-3"
      >
        跳到主区
      </a>
      {!hideSidebar && <AppSidebarView {...sidebarProps} />}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!hideHeader && (
          <WorkbenchHeaderView
            currentProjectName={currentProjectName}
            projects={groups.map((group) => ({ id: group.projectId, name: group.projectName }))}
            onSelectProject={onSelectProject}
            onNewTask={onNewTask}
            newTaskDisabledReason={newTaskDisabledReason}
            isLoading={isLoading}
            healthLabel={healthLabel}
          />
        )}
        <main
          id="workbench-main"
          aria-busy={isLoading}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        >
          <p role="status" className="sr-only">
            {isLoading ? '正在加载项目和任务…' : '已打开任务'}
          </p>
          {terminalSlot}
        </main>
      </div>
      {overlaySlot}
    </div>
  );
}
