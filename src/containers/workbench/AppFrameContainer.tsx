'use client';
import { toast } from 'sonner';
import { preserveProjectDialogFocus } from '@/hooks/workbench/useWorkbenchObjectFocus';
import { selectWorkbenchTask } from '@/hooks/workbench/useWorkbenchRoute';
import { ProjectInfoContainer } from '@/containers/project/ProjectInfoContainer';
import { TaskActionsContainer } from '@/containers/sandbox/TaskActionsContainer';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  useProjects,
  projectKeys,
  useCancelClone,
  describeCancelCloneError,
} from '@/hooks/project/useProjects';
import { useProjectRecovery } from '@/hooks/project/useProjectRecovery';
import { useProjectTaskTree } from '@/hooks/project/useProjectTaskTree';
import { useSandboxes, sandboxListKeys } from '@/hooks/sandbox/useSandboxes';
import { useSandboxEventsSocket } from '@/hooks/sandbox/useSandboxEventsSocket';
import { useRuntimeAuthSync } from '@/hooks/credential/useRuntimeAuthSync';
import { useReportUnauthorized } from '@/hooks/access/useAccessGate';
import { useHealth } from '@/hooks/_shared/useHealth';
import { WorkbenchHeaderView } from '@/views/workbench/WorkbenchHeader.view';
import { useOfflineMode } from '@/hooks/system/useGlobalBanner';
import { useTheme } from '@/hooks/_shared/useTheme';
import { useAppNavigation } from '@/hooks/workbench/useAppNavigation';
import { useAppStore } from '@/stores';
import { AppSidebarView } from '@/views/workbench/AppSidebar.view';
import { ProjectGroupMenuView } from '@/views/project/ProjectGroupMenu.view';
import { ShortcutsView } from '@/views/workbench/Shortcuts.view';
import { GlobalBannerContainer } from '@/containers/banner/GlobalBannerContainer';
import { CommandPaletteContainer } from '@/containers/workbench/CommandPaletteContainer';
import type { Project, Sandbox } from '@/types/domain';
import type { SandboxDto } from '@/types/sandbox';

const WS_BASE_URL = process.env['NEXT_PUBLIC_WS_BASE_URL'] ?? '';
const EMPTY_TASKS: Sandbox[] = [];

/** Lives in the root layout, so navigation preserves the tree and /events connection. */
export function AppFrameContainer({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname !== '/') useAppStore.getState().setWorkbenchNotice(null);
  }, [pathname]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const projects = useProjects();
  const tasks = useSandboxes();
  const { theme, setTheme } = useTheme();
  const navigation = useAppNavigation();
  const offline = useOfflineMode();
  const health = useHealth();
  const { reportRestError, reportUnauthorized } = useReportUnauthorized();
  const selectedProjectId = useAppStore((state) => state.selectedProjectId);
  const selectedSandboxId = useAppStore((state) => state.selectedSandboxId);
  const folds = useAppStore((state) => state.taskListFolds);
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);
  const toggleProjectFold = useAppStore((state) => state.toggleProjectFold);
  const statusFilter = useAppStore((s) => s.taskStatusFilter);
  const setStatusFilter = useAppStore((s) => s.setTaskStatusFilter);
  const search = useAppStore((s) => s.taskSearch);
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const domainProjects = useMemo<Project[]>(
    () =>
      (projects.data ?? []).map((project) => ({
        id: project.id,
        name: project.name,
        cloneStatus: project.cloneStatus,
        taskCount: project.taskCount,
      })),
    [projects.data],
  );
  const tree = useProjectTaskTree(
    domainProjects,
    tasks.data ?? EMPTY_TASKS,
    folds,
    selectedProjectId,
    search,
    statusFilter,
  );
  const syncRuntimeAuth = useRuntimeAuthSync();
  const events = useSandboxEventsSocket({
    base: WS_BASE_URL,
    onUnauthorized: reportUnauthorized,
    onRuntimeAuthChanged: syncRuntimeAuth,
    onConnected: () => {
      void queryClient.invalidateQueries({ queryKey: sandboxListKeys.list() });
      void queryClient.invalidateQueries({ queryKey: projectKeys.all() });
      void queryClient.invalidateQueries({ queryKey: ['sandboxes'] });
    },
    onProjectCloneChanged: (projectId, phase) => {
      if (phase !== 'done' && phase !== 'failed') return;
      void queryClient.invalidateQueries({ queryKey: projectKeys.all() });
      if (phase === 'done') {
        const name = projects.data?.find((project) => project.id === projectId)?.name;
        if (name) toast(`项目「${name}」可用了`);
      }
    },
    onSandboxChanged: (event) => {
      if (event.event === 'sandbox.removed')
        queryClient.setQueryData<SandboxDto[]>(sandboxListKeys.list(), (rows) =>
          rows?.filter((row) => row.id !== event.sandboxId),
        );
      void queryClient.invalidateQueries({ queryKey: sandboxListKeys.list() });
      if (event.event === 'sandbox.created' || event.event === 'sandbox.removed')
        void queryClient.invalidateQueries({ queryKey: projectKeys.all() });
    },
  });
  useEffect(() => {
    if (projects.error) reportRestError(projects.error);
    if (tasks.error) reportRestError(tasks.error);
  }, [projects.error, tasks.error, reportRestError]);
  const openModal = (
    modal: 'createProject' | 'newTask' | 'projectMenu' | 'automations' | 'retainedVolumes',
    projectId?: string,
    confirmDelete = false,
  ): void => {
    const state = useAppStore.getState();
    if (modal === 'createProject') state.setProjectCreateSource(null);
    state.setProjectMenuDeleteRequested(confirmDelete);
    if (projectId !== undefined) state.setSelectedProjectForMenu(projectId);
    state.setCurrentModal(modal);
    setMenuProjectId(null);
    router.push('/');
  };
  const selectProject = (id: string): void => {
    const state = useAppStore.getState();
    state.setWorkbenchNotice(null);
    state.setSelectedProjectId(id);
    state.setSelectedSandboxId(null);
    state.setCurrentModal(null);
    router.push('/');
  };
  const startTask = (): void => {
    const state = useAppStore.getState();
    if (
      projects.isPending ||
      tasks.isPending ||
      offline.offline ||
      !projects.data?.some((project) => project.cloneStatus === 'ready')
    )
      return;
    const current = projects.data.find((project) => project.id === state.selectedProjectId);
    if (current !== undefined && current.cloneStatus !== 'ready') return;
    openModal('newTask');
  };
  const menuProject = projects.data?.find((project) => project.id === menuProjectId);
  const recovery = useProjectRecovery({
    projectId: menuProjectId,
    errorCode: menuProject?.cloneErrorCode,
    onConverted: (id) => {
      setMenuProjectId(null);
      selectProject(id);
    },
  });
  const cancelClone = useCancelClone();
  const actionError =
    recovery.actionError ??
    (cancelClone.isError ? describeCancelCloneError(cancelClone.error) : undefined);
  const selectedProject = projects.data?.find((project) => project.id === selectedProjectId);
  const readyProjects = projects.data?.filter((project) => project.cloneStatus === 'ready') ?? [];
  const taskDisabledReason =
    offline.disabledReason ??
    (selectedProject !== undefined && selectedProject.cloneStatus !== 'ready'
      ? selectedProject.cloneStatus === 'cloning'
        ? '项目还在克隆，克隆完成后可发起'
        : '克隆失败的项目不能发起任务：先重试克隆或改为空项目'
      : readyProjects.length === 0
        ? projects.data?.length === 0
          ? '先新建一个项目'
          : '项目尚未就绪（克隆完成后可发起）'
        : undefined);
  const selectedTask = tasks.data?.find((task) => task.id === selectedSandboxId);
  const pageTitle = pathname.startsWith('/settings/credentials')
    ? '凭证管理'
    : pathname.startsWith('/settings/images')
      ? '镜像管理'
      : '系统状态';
  const disconnected = events.connState === 'reconnecting' || events.connState === 'closed';
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <AppSidebarView
        {...(offline.disabledReason === undefined
          ? {}
          : { newTaskDisabledReason: offline.disabledReason })}
        groups={tree.groups}
        waitingInputCount={tree.waitingInputCount}
        activePath={pathname}
        isLoading={projects.isPending || tasks.isPending}
        {...(disconnected
          ? { eventsMessage: '实时更新已中断，正在重连…\n列表可能不是最新的' }
          : {})}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onFind={navigation.openPalette}
        onShortcuts={navigation.openShortcuts}
        selectedProjectId={selectedProjectId}
        selectedTaskId={selectedSandboxId}
        onSelectProject={selectProject}
        onSelectTask={(id) => {
          const owner = tasks.data?.find((task) => task.id === id);
          if (owner !== undefined) {
            if (pathname !== '/') router.push(`/?taskId=${encodeURIComponent(id)}`);
            selectWorkbenchTask(id, owner.projectId, owner.name);
          }
        }}
        onNewProject={() => {
          openModal('createProject');
        }}
        onNewTask={startTask}
        onToggleGroupCollapse={toggleProjectFold}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        hasNoFilterMatches={tree.hasNoFilterMatches}
        theme={theme}
        onThemeChange={setTheme}
        renderTaskMenu={(task) => (
          <TaskActionsContainer
            id={task.id}
            name={task.name}
            projectId={task.projectId}
            status={task.rawStatus}
          />
        )}
        renderGroupMenu={(id) => {
          const project = projects.data?.find((item) => item.id === id);
          if (project === undefined) return null;
          const open = menuProjectId === id;
          return (
            <ProjectGroupMenuView
              projectId={id}
              projectName={project.name}
              cloneStatus={project.cloneStatus}
              open={open}
              onCloseAutoFocus={preserveProjectDialogFocus}
              onOpenChange={(next) => {
                setMenuProjectId(next ? id : null);
              }}
              busy={open && (recovery.busy || cancelClone.isPending)}
              canRetry={recovery.guidance.canRetry}
              needsCredentials={recovery.guidance.needsCredentials}
              onConfigureCredentials={() => {
                setMenuProjectId(null);
                useAppStore.getState().setPendingProjectCreate({
                  projectId: id,
                  name: project.name,
                  source: 'git',
                  ...(project.repoUrl ? { url: project.repoUrl } : {}),
                });
                router.push('/settings/credentials?section=git');
              }}
              {...(open && actionError !== undefined ? { actionError } : {})}
              onOpenDetail={() => {
                openModal('projectMenu', id);
              }}
              onOpenRetainedVolumes={() => {
                openModal('retainedVolumes', id);
              }}
              onOpenAutomations={() => {
                openModal('automations', id);
              }}
              onRetryClone={recovery.retry}
              onConvertToEmpty={recovery.convertToEmpty}
              onCancelClone={() => {
                cancelClone.mutate(id, {
                  onSuccess: () => {
                    setMenuProjectId(null);
                  },
                });
              }}
              onRequestDelete={() => {
                openModal('projectMenu', id, true);
              }}
            />
          );
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {pathname === '/' ? (
          <WorkbenchHeaderView
            projectInfoSlot={
              selectedProject?.cloneStatus === 'ready' ? (
                <ProjectInfoContainer key={selectedProject.id} project={selectedProject} />
              ) : undefined
            }
            currentTaskName={selectedTask?.name}
            taskStatusLabel={
              selectedTask === undefined
                ? undefined
                : selectedTask.stuck
                  ? '可能卡住'
                  : selectedTask.status === 'preparing'
                    ? '准备中'
                    : selectedTask.status === 'running'
                      ? '运行中'
                      : selectedTask.status === 'error'
                        ? '异常'
                        : selectedTask.status === 'stopping'
                          ? '停止中'
                          : selectedTask.status === 'deleting'
                            ? '删除中'
                            : '已停止'
            }
            taskStatusTone={
              selectedTask?.stuck
                ? 'warn'
                : selectedTask?.status === 'running'
                  ? 'ok'
                  : selectedTask?.status === 'error'
                    ? 'fail'
                    : 'pending'
            }
            moreMenuSlot={
              selectedTask === undefined ? undefined : (
                <TaskActionsContainer
                  id={selectedTask.id}
                  name={selectedTask.name}
                  projectId={selectedTask.projectId}
                  status={selectedTask.rawStatus}
                />
              )
            }
            projects={domainProjects}
            currentProjectName={selectedProject?.name ?? null}
            onSelectProject={selectProject}
            onOverview={() => {
              useAppStore.getState().setSelectedProjectId(null);
              useAppStore.getState().setSelectedSandboxId(null);
            }}
            onNewTask={startTask}
            {...(taskDisabledReason === undefined
              ? {}
              : { newTaskDisabledReason: taskDisabledReason })}
            isLoading={projects.isPending || tasks.isPending}
            healthLabel={health.isError ? '后端不可用' : null}
          />
        ) : (
          <header className="flex h-14 shrink-0 items-center border-b border-[var(--v2-border-subtle)] px-4 sm:px-6">
            <h1 className="text-base font-semibold tracking-[-0.02em]">{pageTitle}</h1>
          </header>
        )}
        <GlobalBannerContainer />
        <div className="min-h-0 flex-1">{children}</div>
      </div>
      {navigation.paletteOpen && (
        <CommandPaletteContainer
          projects={projects.data ?? []}
          tasks={tasks.data ?? []}
          pathname={pathname}
          onClose={navigation.closePalette}
          onCloseAutoFocus={navigation.onCloseAutoFocus}
          deferFocusRestore={navigation.deferFocusRestore}
        />
      )}
      {navigation.shortcutsOpen && (
        <ShortcutsView
          onClose={navigation.closeShortcuts}
          onCloseAutoFocus={navigation.onCloseAutoFocus}
        />
      )}
    </div>
  );
}
