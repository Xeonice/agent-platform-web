import type { ReactNode } from 'react';
import { StatusPill } from '@/components/ui/status-pill';
import { ChevronDown, Plus, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Project } from '@/types/domain';

interface Props {
  currentTaskName?: string;
  currentProjectName?: string | null;
  projects?: Project[];
  onSelectProject?: (id: string) => void;
  onOverview?: () => void;
  onNewTask?: () => void;
  newTaskDisabledReason?: string;
  isLoading?: boolean;
  healthLabel?: string | null;
  taskStatusLabel?: string;
  taskStatusTone?: 'ok' | 'warn' | 'fail' | 'pending' | 'unknown';
  moreMenuSlot?: ReactNode;
  projectInfoSlot?: ReactNode;
}
export function WorkbenchHeaderView({
  currentProjectName = null,
  currentTaskName,
  projects = [],
  onSelectProject,
  onOverview,
  onNewTask,
  newTaskDisabledReason,
  isLoading = false,
  healthLabel,
  taskStatusLabel,
  taskStatusTone = 'unknown',
  moreMenuSlot,
  projectInfoSlot,
}: Props) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--v2-border-subtle)] px-4 sm:px-6">
      <h1 className="hidden text-base font-semibold tracking-[-0.02em] sm:block">任务</h1>
      <span aria-hidden="true" className="hidden text-muted-foreground sm:inline">
        /
      </span>
      {isLoading ? (
        <span aria-hidden="true" className="h-4 w-24 animate-pulse rounded bg-muted" />
      ) : projects.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 max-w-[30%] sm:max-w-[45%] justify-start font-normal"
              aria-label="切换项目"
            >
              <span className="truncate">{currentProjectName ?? '项目总览'}</span>
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={onOverview}>项目总览</DropdownMenuItem>
            {projects.map((project) => (
              <DropdownMenuItem key={project.id} onSelect={() => onSelectProject?.(project.id)}>
                {project.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="text-sm text-muted-foreground">未选择项目</span>
      )}
      {currentTaskName && (
        <span className="hidden min-w-0 truncate text-sm xl:inline">/ {currentTaskName}</span>
      )}
      {projectInfoSlot}
      {taskStatusLabel !== undefined && (
        <StatusPill status={taskStatusTone}>{taskStatusLabel}</StatusPill>
      )}
      {isLoading ? (
        <Button variant="ghost" size="icon" disabled aria-label="更多操作">
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </Button>
      ) : (
        moreMenuSlot
      )}
      {healthLabel && (
        <span className="hidden text-xs text-error sm:inline" data-testid="health-label">
          {healthLabel}
        </span>
      )}
      <div className="group relative ml-auto">
        <Button
          size="sm"
          data-testid="new-task-entry"
          disabled={isLoading}
          aria-disabled={!isLoading && newTaskDisabledReason !== undefined}
          aria-describedby={
            !isLoading && newTaskDisabledReason !== undefined
              ? 'new-task-disabled-reason'
              : undefined
          }
          title={isLoading ? undefined : newTaskDisabledReason}
          className="aria-disabled:opacity-50"
          onClick={() => {
            if (!isLoading && newTaskDisabledReason === undefined) onNewTask?.();
          }}
        >
          <Plus aria-hidden="true" />
          <span className="hidden sm:inline">新任务</span>
          <span className="sr-only sm:hidden">新任务</span>
        </Button>
        {!isLoading && newTaskDisabledReason !== undefined && (
          <p
            id="new-task-disabled-reason"
            role="tooltip"
            className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-56 rounded-md border border-[var(--v2-border)] bg-[var(--v2-surface)] p-2 text-xs text-foreground shadow-[var(--v2-shadow-menu)] group-hover:block group-focus-within:block"
          >
            {newTaskDisabledReason}
          </p>
        )}
      </div>
    </header>
  );
}
