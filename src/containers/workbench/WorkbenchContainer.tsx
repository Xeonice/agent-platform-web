'use client';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useProjects, projectKeys } from '@/hooks/project/useProjects';
import { projectMenuCloseFocus, useWelcomeFocus } from '@/hooks/workbench/useWorkbenchObjectFocus';
import { useWorkbenchRoute, selectWorkbenchTask } from '@/hooks/workbench/useWorkbenchRoute';
import { useProjectRecovery } from '@/hooks/project/useProjectRecovery';
import { useOverviewModel } from '@/hooks/workbench/useOverviewModel';
import { useSandboxes } from '@/hooks/sandbox/useSandboxes';
import { useAppStore } from '@/stores';
import { WorkbenchOverviewView } from '@/views/workbench/WorkbenchOverview.view';
import { WorkbenchShellView } from '@/views/workbench/WorkbenchShell.view';
import { AppDialogView } from '@/views/common/AppDialog.view';
import { SandboxTerminalContainer } from '@/containers/sandbox/SandboxTerminalContainer';
import { NewProjectContainer } from '@/containers/project/NewProjectContainer';
import { ProjectCloneContainer } from '@/containers/project/ProjectCloneContainer';
import { ProjectRecoveryContainer } from '@/containers/project/ProjectRecoveryContainer';
import { RetainedVolumesContainer } from '@/containers/project/RetainedVolumesContainer';
import { ProjectMenuContainer } from '@/containers/project/ProjectMenuContainer';
import { AutomationsPanelContainer } from '@/containers/project/AutomationsPanelContainer';

const WS_BASE_URL = process.env['NEXT_PUBLIC_WS_BASE_URL'] ?? '';

export function WorkbenchContainer() {
  useWorkbenchRoute();
  const router = useRouter();
  const queryClient = useQueryClient();
  const projects = useProjects();
  const sandboxes = useSandboxes();
  useWelcomeFocus(!projects.isPending && projects.data?.length === 0);
  const overviewRecovery = useProjectRecovery({
    projectId: null,
    onConverted: (id) => {
      useAppStore.getState().setSelectedProjectId(id);
    },
  });
  const overview = useOverviewModel(projects.data ?? [], sandboxes.data ?? []);
  const automationFocusRuleId = useAppStore((s) => s.automationFocusRuleId);
  const notice = useAppStore((s) => s.workbenchNotice);
  const setNotice = useAppStore((s) => s.setWorkbenchNotice);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useAppStore((s) => s.setSelectedProjectId);
  const setSelectedSandboxId = useAppStore((s) => s.setSelectedSandboxId);
  const projectCreateSource = useAppStore((s) => s.projectCreateSource);
  const setProjectCreateSource = useAppStore((s) => s.setProjectCreateSource);
  const currentModal = useAppStore((s) => s.currentModal);
  const setCurrentModal = useAppStore((s) => s.setCurrentModal);
  const selectedProjectForMenu = useAppStore((s) => s.selectedProjectForMenu);
  const setSelectedProjectForMenu = useAppStore((s) => s.setSelectedProjectForMenu);
  const menuOpensOnDelete = useAppStore((s) => s.projectMenuDeleteRequested);
  const setMenuOpensOnDelete = useAppStore((s) => s.setProjectMenuDeleteRequested);
  const [newProjectBusy, setNewProjectBusy] = useState(false);
  const [readyProjectId, setReadyProjectId] = useState<string | null>(null);
  const selectedProject =
    projects.data?.find((project) => project.id === selectedProjectId) ?? null;
  const selectedReady =
    selectedProject?.cloneStatus === 'ready' || selectedProjectId === readyProjectId;
  const menuProject =
    projects.data?.find((project) => project.id === selectedProjectForMenu) ?? null;
  const readyProjects = (projects.data ?? []).filter((project) => project.cloneStatus === 'ready');
  const handleSelectProject = (id: string): void => {
    setReadyProjectId(null);
    setSelectedProjectId(id);
    setSelectedSandboxId(null);
    setCurrentModal(null);
  };
  const handleProjectReady = (id: string): void => {
    setProjectCreateSource(null);
    setReadyProjectId(id);
    setSelectedProjectId(id);
    setCurrentModal(null);
    void queryClient.invalidateQueries({ queryKey: projectKeys.all() });
  };
  const closeModal = (): void => {
    setCurrentModal(null);
    setProjectCreateSource(null);
    setSelectedProjectForMenu(null);
    setMenuOpensOnDelete(false);
    useAppStore.getState().setRetainedVolumeFocusSandboxId(null);
    useAppStore.getState().setAutomationFocusRuleId(null);
  };
  const mainContent = ((): React.ReactNode => {
    if (selectedProject !== null && selectedReady) {
      return (
        <SandboxTerminalContainer
          // 换项目 = 换一套上下文（分支选择、指令、已建任务都不该跨项目沿用）⇒ 重挂。
          key={selectedProject.id}
          wsBaseUrl={WS_BASE_URL}
          projectId={selectedProject.id}
          projectName={selectedProject.name}
          projectSourceType={selectedProject.sourceType}
          projects={projects.data ?? []}
          launchProjectId={selectedProject.id}
        />
      );
    }
    const launchProject = readyProjects[0];
    if (currentModal === 'newTask' && selectedProject === null && launchProject !== undefined) {
      return (
        <SandboxTerminalContainer
          key="overview-launch"
          wsBaseUrl={WS_BASE_URL}
          projectId={launchProject.id}
          projectName={launchProject.name}
          projectSourceType={launchProject.sourceType}
          projects={projects.data ?? []}
          launchProjectId={null}
        />
      );
    }
    // 失败项目：在创建会话之外也能触达 retry-clone / convert-to-empty（P0-1）。
    if (selectedProject !== null && selectedProject.cloneStatus === 'failed') {
      return (
        <ProjectRecoveryContainer
          projectId={selectedProject.id}
          projectName={selectedProject.name}
          errorCode={selectedProject.cloneErrorCode}
          onConverted={handleProjectReady}
        />
      );
    }
    if (selectedProject !== null)
      return (
        <ProjectCloneContainer
          project={selectedProject}
          onBack={() => {
            setSelectedProjectId(null);
            setSelectedSandboxId(null);
          }}
        />
      );
    return (
      <WorkbenchOverviewView
        {...overview}
        onRecoverProject={(id, credentials) => {
          if (credentials) router.push('/settings/credentials?section=git');
          else overviewRecovery.retry(id);
        }}
        onConvertProject={(id) => {
          overviewRecovery.convertToEmpty(id);
        }}
        recoveryBusy={overviewRecovery.busy}
        recoveryError={overviewRecovery.actionError ?? undefined}
        onNewTask={() => {
          setCurrentModal('newTask');
        }}
        projects={projects.data ?? []}
        tasks={sandboxes.data ?? []}
        isLoading={projects.isPending || sandboxes.isPending}
        isError={projects.isError || sandboxes.isError}
        onRetry={() => {
          void projects.refetch();
          void sandboxes.refetch();
        }}
        onSelectProject={handleSelectProject}
        onSelectTask={(id) => {
          const task = sandboxes.data?.find((task) => task.id === id);
          if (task) selectWorkbenchTask(id, task.projectId, task.name);
        }}
        onNewProject={(source) => {
          setProjectCreateSource(source ?? null);
          setCurrentModal('createProject');
        }}
      />
    );
  })();

  return (
    <WorkbenchShellView
      hideSidebar
      hideHeader
      isLoading={projects.isPending || sandboxes.isPending}
      groups={[]}
      waitingInputCount={0}
      healthLabel={null}
      terminalSlot={
        <>
          {notice !== null && (
            <div
              role="status"
              className="flex items-start gap-3 border-b border-border bg-muted/30 px-6 py-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p>{notice.message}</p>
                {notice.description !== undefined && (
                  <p className="mt-1 text-xs text-muted-foreground">{notice.description}</p>
                )}
                {notice.retainedProjectId && (
                  <button
                    className="mt-1 text-xs underline"
                    onClick={() => {
                      setSelectedProjectForMenu(notice.retainedProjectId ?? null);
                      setCurrentModal('retainedVolumes');
                    }}
                  >
                    保留下来的成果
                  </button>
                )}
                <span className="sr-only">已打开 项目总览</span>
              </div>
              <button
                aria-label="关闭提示"
                onClick={() => {
                  setNotice(null);
                }}
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1">{mainContent}</div>
        </>
      }
      overlaySlot={
        <>
          {currentModal === 'createProject' && (
            <AppDialogView
              title="新建项目"
              busy={newProjectBusy}
              onClose={closeModal}
              testId="modal-new-project"
            >
              <NewProjectContainer
                focusRepository={projectCreateSource === 'git'}
                initialSourceType={projectCreateSource ?? 'git'}
                onBusyChange={setNewProjectBusy}
                onProjectReady={handleProjectReady}
                onProjectCreated={(id) => {
                  setSelectedProjectId(id);
                  setSelectedSandboxId(null);
                }}
                onCancel={closeModal}
              />
            </AppDialogView>
          )}
          {currentModal === 'projectMenu' && menuProject !== null && (
            <ProjectMenuContainer
              ownDialog
              projectId={menuProject.id}
              projectName={menuProject.name}
              cloneStatus={menuProject.cloneStatus}
              taskCount={menuProject.taskCount}
              createdAt={menuProject.createdAt}
              initialConfirmingDelete={menuOpensOnDelete}
              onClose={closeModal}
              onDeleted={closeModal}
              onCloseAutoFocus={projectMenuCloseFocus(menuProject.id)}
            />
          )}
          {currentModal === 'automations' && menuProject !== null && (
            <AutomationsPanelContainer
              key={`${menuProject.id}:${automationFocusRuleId ?? 'list'}`}
              focusRuleId={automationFocusRuleId ?? undefined}
              projectId={menuProject.id}
              projectName={menuProject.name}
              onClose={closeModal}
              onCloseAutoFocus={projectMenuCloseFocus(menuProject.id)}
              onOpenTask={(id) => {
                closeModal();
                selectWorkbenchTask(id, menuProject.id);
              }}
              onViewArtifacts={(id) => {
                const state = useAppStore.getState();
                state.setRetainedVolumeFocusSandboxId(id);
                state.setCurrentModal('retainedVolumes');
              }}
            />
          )}
          {currentModal === 'retainedVolumes' && (
            <RetainedVolumesContainer
              projectId={menuProject?.id ?? null}
              projectName={menuProject?.name ?? '全部项目'}
              onClose={closeModal}
              onCloseAutoFocus={menuProject ? projectMenuCloseFocus(menuProject.id) : undefined}
            />
          )}
        </>
      }
    />
  );
}
