import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Activity,
  ChevronsUpDown,
  FolderPlus,
  KeyRound,
  ListFilter,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  SquareTerminal,
  SunMoon,
  Keyboard,
  WifiOff,
  X,
} from 'lucide-react';
import type { ProjectGroup, Sandbox, SandboxStatus, TaskStatusFilter } from '@/types/domain';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusDot, type StatusPillStatus } from '@/components/ui/status-pill';
import { ProjectGroupHeaderView } from '@/views/project/ProjectGroupHeader.view';

export type ThemeChoice = 'system' | 'dark' | 'light';
const THEME_LABEL: Record<ThemeChoice, string> = {
  system: '跟随系统',
  dark: '暗色',
  light: '亮色',
};
const STATUS_FILTER_LABEL: Record<TaskStatusFilter, string> = {
  all: '全部',
  preparing: '准备中',
  running: '运行中',
  waitingInput: '等待输入',
  paused: '已暂停',
  error: '异常',
  stopped: '已停止',
};
const STATUS_FILTER_ORDER: TaskStatusFilter[] = [
  'all',
  'preparing',
  'running',
  'waitingInput',
  'stopped',
  'error',
];
const TASK_DOT: Record<SandboxStatus, Exclude<StatusPillStatus, 'pending' | 'skipped'>> = {
  preparing: 'unknown',
  running: 'ok',
  'waiting-input': 'info',
  paused: 'warn',
  error: 'fail',
  stopped: 'unknown',
  stopping: 'unknown',
  deleting: 'unknown',
};
const TASK_LABEL: Record<SandboxStatus, string> = {
  preparing: '准备中',
  running: '运行中',
  'waiting-input': '等待输入',
  paused: '已暂停',
  error: '异常',
  stopped: '已停止',
  stopping: '停止中',
  deleting: '删除中',
};

export interface AppSidebarProps {
  groups: ProjectGroup[];
  activePath?: string;
  isLoading?: boolean;
  eventsMessage?: string;
  newTaskDisabledReason?: string;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onFind?: () => void;
  onShortcuts?: () => void;
  waitingInputCount: number;
  selectedTaskId?: string | null;
  selectedProjectId?: string | null;
  onSelectTask?: (taskId: string) => void;
  onSelectProject?: (projectId: string) => void;
  onNewProject?: () => void;
  onNewTask?: () => void;
  renderTaskMenu?: (task: Sandbox) => ReactNode;
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
export function AppSidebarView({
  groups,
  waitingInputCount,
  activePath = '/',
  isLoading = false,
  eventsMessage,
  newTaskDisabledReason,
  selectedTaskId = null,
  selectedProjectId = null,
  onSelectTask,
  onSelectProject,
  onNewProject,
  onNewTask,
  renderGroupMenu,
  renderTaskMenu,
  onToggleGroupCollapse,
  onFind,
  onShortcuts,
  searchQuery = '',
  statusFilter = 'all',
  onStatusFilterChange,
  hasNoFilterMatches = false,
  systemStatusHref = '/settings/system',
  theme = 'system',
  onThemeChange,
  sidebarCollapsed = false,
  onToggleSidebar,
}: AppSidebarProps) {
  const navigation = [
    { href: '/', label: '任务', icon: SquareTerminal },
    { href: '/settings/credentials', label: '凭证管理', icon: KeyRound },
    { href: '/settings/images', label: '镜像管理', icon: Package },
    { href: systemStatusHref, label: '系统状态', icon: Activity },
  ];
  return (
    <aside
      id="workbench-sidebar"
      aria-label="侧栏"
      className={
        'flex shrink-0 flex-col border-r border-[var(--v2-border-subtle)] ' +
        (sidebarCollapsed ? 'w-12' : 'w-12 sm:w-[256px]')
      }
    >
      <div className="flex h-14 items-center gap-2 px-2 sm:px-4">
        <Link
          href="/"
          className="flex min-w-0 flex-1 items-center gap-2"
          aria-label="Agent 管理平台，回到工作台"
        >
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
          >
            A
          </span>
          {!sidebarCollapsed && (
            <span className="hidden truncate text-sm font-medium sm:inline">Agent 管理平台</span>
          )}
        </Link>
        {!sidebarCollapsed && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hidden size-7 sm:inline-flex"
                aria-label="实例菜单：系统状态、外观、快捷键"
                data-testid="nav-settings-menu-trigger"
              >
                <ChevronsUpDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem asChild>
                <Link href={systemStatusHref}>系统状态</Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onShortcuts}>快捷键</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>外观</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(value) => {
                  if (value === 'system' || value === 'dark' || value === 'light')
                    onThemeChange?.(value);
                }}
              >
                {(['system', 'light', 'dark'] as const).map((value) => (
                  <DropdownMenuRadioItem key={value} value={value} data-testid={`theme-${value}`}>
                    {THEME_LABEL[value]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="px-2 pb-3 sm:px-3">
        <Button
          variant="outline"
          className="h-8 w-full justify-start px-2 font-normal text-muted-foreground"
          onClick={onFind}
          data-command-trigger=""
          aria-label="查找任务、项目与动作（⌘K）"
          aria-haspopup="dialog"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <Search aria-hidden="true" />
          <span className={sidebarCollapsed ? 'sr-only' : 'sr-only sm:not-sr-only'}>查找…</span>
          {!sidebarCollapsed && <kbd className="ml-auto hidden text-xs sm:inline">⌘K</kbd>}
        </Button>
      </div>
      {eventsMessage && (
        <div role="status" className="px-2 py-2 text-xs text-warning" title={eventsMessage}>
          <WifiOff
            aria-hidden="true"
            className={sidebarCollapsed ? 'mx-auto size-4' : 'mx-auto size-4 sm:hidden'}
          />
          <p
            className={sidebarCollapsed ? 'sr-only' : 'sr-only whitespace-pre-line sm:not-sr-only'}
          >
            {eventsMessage}
          </p>
        </div>
      )}
      <nav aria-label="主导航" className="flex flex-col gap-1 px-2 pb-4 sm:px-3">
        {navigation.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            title={label}
            aria-label={label}
            aria-current={href === activePath ? 'page' : undefined}
            className={
              'flex h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted ' +
              (href === activePath
                ? 'bg-[var(--v2-fill-selected)] text-foreground'
                : 'text-muted-foreground')
            }
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className={sidebarCollapsed ? 'sr-only' : 'sr-only sm:not-sr-only'}>{label}</span>
            {href === '/' && waitingInputCount > 0 && !sidebarCollapsed && (
              <span
                className="ml-auto hidden rounded-full bg-[var(--v2-status-info-subtle-bg)] px-1.5 text-xs text-info sm:inline"
                aria-label={`${String(waitingInputCount)} 个任务等待你输入`}
              >
                {waitingInputCount}
              </span>
            )}
          </Link>
        ))}
      </nav>
      {!sidebarCollapsed && (
        <section
          className="mx-3 hidden min-h-0 flex-1 flex-col border-t border-[var(--v2-sidebar-sep)] sm:flex"
          aria-label="项目"
        >
          <div className="flex h-12 items-center gap-1 px-1">
            <h2 className="flex-1 text-xs font-medium text-muted-foreground">项目</h2>
            {(groups.length > 0 || statusFilter !== 'all') && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    title={`按状态筛选任务：${STATUS_FILTER_LABEL[statusFilter]}`}
                    aria-label="按状态筛选任务"
                  >
                    <ListFilter />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup
                    value={statusFilter}
                    onValueChange={(value) => {
                      const next = STATUS_FILTER_ORDER.find((v) => v === value);
                      if (next) onStatusFilterChange?.(next);
                    }}
                  >
                    {STATUS_FILTER_ORDER.map((value) => (
                      <DropdownMenuRadioItem
                        key={value}
                        value={value}
                        data-testid={`task-filter-${value}`}
                      >
                        {STATUS_FILTER_LABEL[value]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="新建项目"
              title="新建项目"
              onClick={onNewProject}
            >
              <FolderPlus />
            </Button>
          </div>
          {statusFilter !== 'all' && (
            <Button
              variant="outline"
              size="sm"
              className="mx-2 mb-2 w-fit"
              aria-label={`移除筛选：${STATUS_FILTER_LABEL[statusFilter]}`}
              onClick={() => onStatusFilterChange?.('all')}
            >
              {STATUS_FILTER_LABEL[statusFilter]}
              <X aria-hidden="true" className="size-3" />
            </Button>
          )}
          <nav className="min-h-0 flex-1 overflow-y-auto pb-3" aria-label="项目分组任务树">
            {isLoading ? (
              <div role="status" aria-label="正在加载项目和任务…" className="space-y-4 px-2">
                {[0, 1].map((i) => (
                  <div key={i} aria-hidden="true" className="space-y-3">
                    <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                    {[0, 1, 2].map((j) => (
                      <div key={j} className="ml-4 h-8 animate-pulse rounded bg-muted" />
                    ))}
                  </div>
                ))}
              </div>
            ) : hasNoFilterMatches ? (
              <p className="p-3 text-sm text-muted-foreground" data-testid="task-search-no-results">
                {searchQuery.trim()
                  ? `没有找到匹配“${searchQuery.trim()}”的任务`
                  : `没有${STATUS_FILTER_LABEL[statusFilter]}的任务`}
              </p>
            ) : (
              groups.map((group) => (
                <section key={group.projectId} className="mb-3">
                  <ProjectGroupHeaderView
                    projectId={group.projectId}
                    projectName={group.projectName}
                    taskCount={group.taskCount}
                    cloneStatus={group.cloneStatus}
                    selected={selectedProjectId === group.projectId}
                    onSelect={(id) => onSelectProject?.(id)}
                    collapsed={group.collapsed}
                    onToggleCollapse={(id) => onToggleGroupCollapse?.(id)}
                    menuSlot={renderGroupMenu?.(group.projectId)}
                  />
                  {!group.collapsed &&
                    group.cloneStatus === 'ready' &&
                    (group.tasks.length === 0 ? (
                      <button
                        type="button"
                        data-testid={`empty-group-new-task-${group.projectId}`}
                        title={newTaskDisabledReason ?? `在 ${group.projectName} 中发起第一个任务`}
                        aria-disabled={newTaskDisabledReason !== undefined}
                        className="w-full px-7 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          if (newTaskDisabledReason !== undefined) return;
                          onSelectProject?.(group.projectId);
                          onNewTask?.();
                        }}
                      >
                        发起第一个任务 →
                      </button>
                    ) : (
                      <ul>
                        {group.tasks.map((task) => (
                          <li
                            key={task.id}
                            className={task.status === 'deleting' ? 'opacity-50' : undefined}
                          >
                            <div className="flex items-center">
                              <button
                                type="button"
                                aria-current={selectedTaskId === task.id || undefined}
                                className={
                                  'flex min-w-0 flex-1 items-center gap-2 rounded-md py-2 pl-7 pr-2 text-left text-sm hover:bg-muted ' +
                                  (selectedTaskId === task.id ? 'bg-[var(--v2-fill-selected)]' : '')
                                }
                                disabled={task.status === 'deleting'}
                                onClick={() => onSelectTask?.(task.id)}
                              >
                                <StatusDot
                                  status={
                                    task.stuck
                                      ? 'warn'
                                      : task.waitingInput
                                        ? 'info'
                                        : TASK_DOT[task.status]
                                  }
                                  className={
                                    task.status === 'stopped' || task.status === 'stopping'
                                      ? 'rounded-none'
                                      : task.status === 'preparing'
                                        ? 'animate-pulse'
                                        : undefined
                                  }
                                  label={
                                    task.stuck
                                      ? '可能卡住'
                                      : task.waitingInput
                                        ? '等待你输入'
                                        : TASK_LABEL[task.status]
                                  }
                                />
                                <span className="truncate">{task.name}</span>
                                {task.sourceAutomationId && (
                                  <span className="shrink-0 rounded bg-muted px-1 text-xs text-muted-foreground">
                                    自动
                                  </span>
                                )}
                              </button>
                              {renderTaskMenu?.(task)}
                            </div>
                            {task.phaseLabel !== undefined && (
                              <p
                                className={
                                  'truncate pb-1 pl-11 text-xs ' +
                                  (task.stuck
                                    ? 'text-warning'
                                    : task.status === 'error'
                                      ? task.failureCode === 'TIMEOUT'
                                        ? 'text-timeout'
                                        : 'text-error'
                                      : 'text-muted-foreground')
                                }
                              >
                                {task.stuck
                                  ? `可能卡住 · ${task.stuckElapsed ?? ''} 无进展`
                                  : task.phaseLabel}
                              </p>
                            )}
                            {(task.activityLabel !== undefined || task.waitingInput) && (
                              <p
                                className="truncate pb-1 pl-11 text-xs text-muted-foreground"
                                data-testid={`task-activity-${task.id}`}
                              >
                                {task.activityLabel}
                                {task.activityLabel !== undefined && task.waitingInput && ' · '}
                                {task.waitingInput && <span className="text-info">等待输入</span>}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    ))}
                </section>
              ))
            )}
          </nav>
        </section>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label="新建项目"
        onClick={onNewProject}
        className={sidebarCollapsed ? 'mx-auto mb-2' : 'mx-auto mb-2 sm:hidden'}
      >
        <FolderPlus aria-hidden="true" />
      </Button>
      <div
        className={
          'mt-auto flex items-center border-t border-[var(--v2-border-subtle)] py-2 ' +
          (sidebarCollapsed ? 'flex-col' : 'flex-col sm:h-12 sm:flex-row sm:justify-end sm:px-3')
        }
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="外观">
              <SunMoon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => {
                if (value === 'system' || value === 'dark' || value === 'light')
                  onThemeChange?.(value);
              }}
            >
              {(['system', 'light', 'dark'] as const).map((value) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {THEME_LABEL[value]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="ghost" size="icon" aria-label="快捷键" onClick={onShortcuts}>
          <Keyboard aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-controls="workbench-sidebar"
          aria-expanded={!sidebarCollapsed}
          aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
          onClick={onToggleSidebar}
        >
          {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
      </div>
    </aside>
  );
}
