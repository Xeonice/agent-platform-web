import {
  Folder,
  SquareTerminal,
  GitBranch,
  ArrowRight,
  Search,
  ListFilter,
  ChevronDown,
  X,
} from 'lucide-react';
import type { Project, Sandbox, TaskStatusFilter } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';

const FILTER_LABEL: Record<TaskStatusFilter, string> = {
  all: '全部',
  preparing: '准备中',
  running: '运行中',
  waitingInput: '等待输入',
  stopped: '已停止',
  error: '异常',
  paused: '已暂停',
};
interface WorkbenchOverviewProps {
  statusFilter?: TaskStatusFilter;
  search?: string;
  onStatusFilterChange?: (filter: TaskStatusFilter) => void;
  onSearchChange?: (value: string) => void;
  attention?: Sandbox[];
  recent?: Sandbox[];
  filteredProjects?: Project[];
  totalProjectCount?: number;
  resourceRows?: string[];
  resourcesError?: boolean;
  onRetryResources?: () => void;
  onNewTask?: () => void;
  onConvertProject?: (id: string) => void;
  recoveryBusy?: boolean;
  recoveryError?: string;
  onRecoverProject?: (id: string, credentials: boolean) => void;
  projectMeta?: Record<
    string,
    {
      countText: string;
      failureMessage?: string;
      canRetry: boolean;
      needsCredentials: boolean;
      lastPull?: string;
    }
  >;

  projects: Project[];
  tasks: Sandbox[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onSelectProject: (id: string) => void;
  onSelectTask: (id: string) => void;
  onNewProject: (source?: 'git' | 'empty') => void;
}

export function WorkbenchOverviewView({
  projects,
  tasks,
  isLoading,
  isError,
  onRetry,
  onSelectProject,
  onSelectTask,
  onNewProject,
  statusFilter = 'all',
  search = '',
  onStatusFilterChange,
  onSearchChange,
  attention: attentionProp,
  recent = [],
  filteredProjects: filteredProjectsProp,
  totalProjectCount,
  resourceRows,
  resourcesError,
  onRetryResources,
  onNewTask,
  onRecoverProject,
  onConvertProject,
  recoveryBusy = false,
  recoveryError,
  projectMeta,
}: WorkbenchOverviewProps) {
  const taskCounts = new Map<string, number>();
  for (const task of tasks)
    taskCounts.set(task.projectId, (taskCounts.get(task.projectId) ?? 0) + 1);
  const visibleProjects = filteredProjectsProp ?? projects;
  const attention =
    attentionProp ??
    tasks
      .filter((task) => task.status === 'error' || task.waitingInput)
      .sort((a, b) => Number(b.status === 'error') - Number(a.status === 'error'));
  const isWelcome = !isLoading && !isError && projects.length === 0;
  return (
    <div className="h-full min-h-0 overflow-y-auto p-4 sm:p-6">
      {recoveryError && (
        <p role="alert" className="mb-4 text-xs text-error">
          {recoveryError}
        </p>
      )}
      {!isWelcome && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-base font-semibold">项目总览</h2>
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3 sm:max-w-xs">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <input
              type="search"
              aria-label="搜索项目与任务"
              placeholder="搜索项目与任务…"
              value={search}
              onChange={(e) => onSearchChange?.(e.target.value)}
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="按状态筛选">
                <ListFilter aria-hidden="true" className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuRadioGroup
                value={statusFilter}
                onValueChange={(value) => {
                  const next = (
                    ['all', 'preparing', 'running', 'waitingInput', 'stopped', 'error'] as const
                  ).find((key) => key === value);
                  if (next !== undefined) onStatusFilterChange?.(next);
                }}
              >
                {(['all', 'preparing', 'running', 'waitingInput', 'stopped', 'error'] as const).map(
                  (value) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      {FILTER_LABEL[value]}
                    </DropdownMenuRadioItem>
                  ),
                )}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {statusFilter !== 'all' && (
            <Button
              size="sm"
              variant="outline"
              aria-label={`移除筛选：${FILTER_LABEL[statusFilter]}`}
              onClick={() => onStatusFilterChange?.('all')}
            >
              {FILTER_LABEL[statusFilter]}
              <X aria-hidden="true" className="size-3" />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                新建
                <ChevronDown aria-hidden="true" className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onNewTask}>新任务…</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  onNewProject();
                }}
              >
                新建项目…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm">
          <span>读取项目和任务失败，请重试。</span>
          <Button size="sm" variant="outline" onClick={onRetry}>
            重试
          </Button>
        </div>
      ) : isLoading ? (
        <div role="status" aria-label="正在加载项目和任务" className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <section
          className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center gap-6 py-12 text-center"
          aria-labelledby="workbench-welcome-title"
        >
          <p className="text-xs font-medium text-muted-foreground">欢迎使用 · 第一步</p>
          <h2
            id="workbench-welcome-title"
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight"
          >
            为你的代码建一个项目
          </h2>
          <p className="text-sm text-muted-foreground">
            先有项目，再在项目里发起任务。每个任务都在项目代码的一份副本上干活，互不干扰。
          </p>
          <div className="grid w-full gap-4 sm:grid-cols-2">
            {[
              {
                source: 'git' as const,
                title: '用我的代码库',
                description:
                  '填 Git 仓库地址，平台把代码克隆到这台机器上。私有仓库会先引导你配好 Git 凭证。',
                icon: GitBranch,
              },
              {
                source: 'empty' as const,
                title: '开一个空项目',
                description: '从一个空目录开始，不关联任何仓库。名称先填好，建之前可以改。',
                icon: Folder,
              },
            ].map(({ source, title, description, icon: Icon }) => (
              <button
                key={source}
                type="button"
                onClick={() => {
                  onNewProject(source);
                }}
                className="flex flex-col gap-4 rounded-[var(--v2-radius-xl)] bg-card p-6 text-left shadow-[var(--v2-shadow-card)] hover:shadow-[var(--v2-shadow-raised)]"
                aria-haspopup="dialog"
                aria-labelledby={`welcome-${source}-title`}
                aria-describedby={`welcome-${source}-description`}
              >
                <Icon aria-hidden="true" className="size-6 text-muted-foreground" />
                <span
                  id={`welcome-${source}-title`}
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  {title}
                  <ArrowRight aria-hidden="true" className="ml-auto size-4" />
                </span>
                <span
                  id={`welcome-${source}-description`}
                  className="text-sm text-muted-foreground"
                >
                  {description}
                </span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            第二步 · 项目就绪后会自动选中，接着就能发起第一个任务。
          </p>
        </section>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(260px,1fr)_2fr]">
          <div className="space-y-6">
            <section aria-labelledby="overview-resources">
              <h3 id="overview-resources" className="mb-3 text-sm font-medium">
                本机资源
              </h3>
              <div className="space-y-3 rounded-md bg-card p-4 text-sm shadow-[var(--v2-shadow-card)]">
                {resourceRows === undefined ? (
                  resourcesError ? (
                    <div role="alert">
                      本机资源暂时读不到。
                      <Button variant="ghost" size="sm" onClick={onRetryResources}>
                        重试
                      </Button>
                    </div>
                  ) : (
                    <div
                      role="status"
                      aria-label="正在读取本机资源"
                      className="h-20 animate-pulse rounded bg-muted"
                    />
                  )
                ) : (
                  resourceRows.map((row) => <p key={row}>{row}</p>)
                )}
              </div>
            </section>
            <section aria-labelledby="overview-attention">
              <h3 id="overview-attention" className="mb-3 text-sm font-medium">
                需要你处理{' '}
                <span className="ml-1 text-xs text-muted-foreground">{attention.length}</span>
              </h3>
              <div className="overflow-hidden rounded-md bg-card shadow-[var(--v2-shadow-card)]">
                {attention.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">目前没有需要你处理的任务。</p>
                ) : (
                  attention.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      className="flex w-full items-center gap-3 border-b p-4 text-left last:border-0 hover:bg-muted"
                      onClick={() => {
                        onSelectTask(task.id);
                      }}
                    >
                      <SquareTerminal
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{task.name}</span>
                      <StatusPill
                        status={task.status === 'error' ? 'fail' : task.stuck ? 'warn' : 'info'}
                      >
                        {task.status === 'error' ? '异常' : task.stuck ? '可能卡住' : '等待输入'}
                      </StatusPill>
                    </button>
                  ))
                )}
              </div>
            </section>
          </div>
          <div className="space-y-6">
            <section aria-labelledby="overview-recent">
              <h3 id="overview-recent" className="mb-3 text-sm font-medium">
                最近任务
              </h3>
              <div className="overflow-hidden rounded-md bg-card shadow-[var(--v2-shadow-card)]">
                {recent.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">
                    {statusFilter === 'waitingInput' || statusFilter === 'error'
                      ? `${FILTER_LABEL[statusFilter]}的任务都列在「需要你处理」里`
                      : statusFilter === 'all'
                        ? '还没有最近任务。'
                        : `没有${FILTER_LABEL[statusFilter]}的任务`}
                  </p>
                ) : (
                  recent.map((task) => (
                    <button
                      key={task.id}
                      className="flex w-full items-center gap-3 border-b p-4 text-left text-sm last:border-0 hover:bg-muted"
                      onClick={() => {
                        onSelectTask(task.id);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{task.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {task.phaseLabel ??
                          FILTER_LABEL[
                            task.status === 'stopped'
                              ? 'stopped'
                              : task.status === 'preparing'
                                ? 'preparing'
                                : 'running'
                          ]}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </section>
            <section aria-labelledby="overview-projects">
              <h3 id="overview-projects" className="mb-3 text-sm font-medium">
                项目{' '}
                <span className="ml-1 text-xs text-muted-foreground">{visibleProjects.length}</span>
                {statusFilter !== 'all' && (
                  <span className="float-right text-xs text-muted-foreground">
                    按筛选显示 {visibleProjects.length} 个 / 共{' '}
                    {totalProjectCount ?? projects.length} 个
                  </span>
                )}
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                {visibleProjects.map((project) => {
                  const count = project.taskCount ?? taskCounts.get(project.id) ?? 0;
                  return (
                    <div
                      key={project.id}
                      className="rounded-md bg-card shadow-[var(--v2-shadow-card)]"
                    >
                      <button
                        type="button"
                        className="flex min-h-28 w-full flex-col gap-4 rounded-md p-4 text-left transition-shadow hover:shadow-[var(--v2-shadow-raised)]"
                        onClick={() => {
                          onSelectProject(project.id);
                        }}
                      >
                        <span className="flex w-full items-center gap-2">
                          <Folder aria-hidden="true" className="size-4 text-muted-foreground" />
                          <span className="truncate text-sm font-medium">{project.name}</span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {projectMeta?.[project.id]?.countText ?? `${String(count)} 个任务`}
                          {project.cloneStatus === 'cloning'
                            ? ' · 克隆中'
                            : project.cloneStatus === 'failed'
                              ? ' · 克隆失败'
                              : ''}
                        </span>
                        {projectMeta?.[project.id]?.lastPull && (
                          <span className="text-xs text-muted-foreground">
                            最后拉取：{projectMeta[project.id]?.lastPull}
                          </span>
                        )}
                      </button>
                      {project.cloneStatus === 'failed' && (
                        <div className="space-y-2 px-4 pb-4">
                          <p className="text-xs text-error">
                            {projectMeta?.[project.id]?.failureMessage ?? '项目克隆失败。'}
                          </p>
                          <Button
                            disabled={recoveryBusy}
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              onRecoverProject?.(
                                project.id,
                                projectMeta?.[project.id]?.needsCredentials === true,
                              )
                            }
                          >
                            {projectMeta?.[project.id]?.needsCredentials
                              ? '配置 Git 凭证'
                              : '重试克隆'}
                          </Button>
                          <Button
                            disabled={recoveryBusy}
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              onConvertProject?.(project.id);
                            }}
                          >
                            改为空项目
                          </Button>
                          <p className="text-xs text-muted-foreground">
                            项目和已有任务都留着，只是代码副本从空的开始，不再关联这个仓库。
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
