'use client';
// 工作台容器（S2）：项目列表 → 左侧树；主区在「新建项目 / 建沙箱+终端 / 占位」间路由。
// 全局订阅 /events（sandbox 状态 + 项目 clone 进度都靠它推进）；唯一 view↔hooks 粘合点（07 §2）。
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useHealth } from '@/hooks/useHealth';
import { useProjects, projectKeys } from '@/hooks/useProjects';
import { useProjectTaskTree } from '@/hooks/useProjectTaskTree';
import { useSandboxEventsSocket } from '@/hooks/useSandboxEventsSocket';
import { useRuntimeAuthSync } from '@/hooks/useRuntimeAuthSync';
import { useReportUnauthorized } from '@/hooks/useAccessGate';
import { useAppStore } from '@/stores';
import { WorkbenchShellView } from '@/views/workbench/WorkbenchShell.view';
import { SandboxTerminalContainer } from '@/containers/SandboxTerminalContainer';
import { NewProjectContainer } from '@/containers/NewProjectContainer';
import { ProjectRecoveryContainer } from '@/containers/ProjectRecoveryContainer';
import type { Project, Sandbox } from '@/types/domain';

const WS_BASE_URL = process.env['NEXT_PUBLIC_WS_BASE_URL'] ?? 'ws://localhost:3001';

// sandbox 列表端点在后续切片接入（S2 只做项目 + 建沙箱）；先空，树计数用 DTO 的 taskCount。
const NO_TASKS: Sandbox[] = [];

export function WorkbenchContainer() {
  const health = useHealth();
  const projects = useProjects();
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useAppStore((s) => s.setSelectedProjectId);
  const currentModal = useAppStore((s) => s.currentModal);
  const setCurrentModal = useAppStore((s) => s.setCurrentModal);
  const taskListFolds = useAppStore((s) => s.taskListFolds);
  const { reportRestError, reportUnauthorized } = useReportUnauthorized();
  const queryClient = useQueryClient();

  // 全局 /events 订阅：项目 clone 进度在建沙箱之前就要收，故挂在工作台顶层（未授权 → 解锁门）。
  // runtime-auth.status_changed → patch runtime 凭证 Query（横幅/卡片同源刷新，15 §2.3）。
  const syncRuntimeAuth = useRuntimeAuthSync();
  useSandboxEventsSocket({
    base: WS_BASE_URL,
    onUnauthorized: reportUnauthorized,
    onRuntimeAuthChanged: syncRuntimeAuth,
  });

  // 建流程内确认就绪的项目（clone done / 转空），绕过列表 staleTime 的短暂过期读。
  const [readyProjectId, setReadyProjectId] = useState<string | null>(null);

  // 项目列表 401 → 弹解锁门（健康探针 passcode-exempt 不受影响）。
  useEffect(() => {
    if (projects.error) reportRestError(projects.error);
  }, [projects.error, reportRestError]);

  const domainProjects = useMemo<Project[]>(
    () =>
      (projects.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        // 与后端同词汇直传（'ready'|'cloning'|'failed'）；徽标只对 cloning/failed 显示。
        cloneStatus: p.cloneStatus,
        // taskCount 直接来自生成物 ProjectResponseDto（后端权威计数）。
        taskCount: p.taskCount,
      })),
    [projects.data],
  );

  const { groups, waitingInputCount } = useProjectTaskTree(
    domainProjects,
    NO_TASKS,
    taskListFolds,
    selectedProjectId,
  );

  const selectedProject = projects.data?.find((p) => p.id === selectedProjectId) ?? null;
  const selectedReady =
    selectedProject?.cloneStatus === 'ready' || selectedProjectId === readyProjectId;

  const healthLabel =
    health.data !== undefined
      ? `后端健康（HTTP ${String(health.data.status)}）`
      : health.isError
        ? '后端不可用'
        : '正在检查后端…';

  const handleSelectProject = (projectId: string): void => {
    setReadyProjectId(null); // 手动切换：就绪判定回到列表口径
    setSelectedProjectId(projectId);
    setCurrentModal(null);
  };

  const handleProjectReady = (projectId: string): void => {
    setReadyProjectId(projectId);
    setSelectedProjectId(projectId);
    setCurrentModal(null);
    void queryClient.invalidateQueries({ queryKey: projectKeys.all() });
  };

  const mainContent = ((): React.ReactNode => {
    if (currentModal === 'createProject') {
      return (
        <NewProjectContainer
          onProjectReady={handleProjectReady}
          onCancel={() => {
            setCurrentModal(null);
          }}
        />
      );
    }
    if (selectedProject !== null && selectedReady) {
      return <SandboxTerminalContainer wsBaseUrl={WS_BASE_URL} projectId={selectedProject.id} />;
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
    if (selectedProject !== null) {
      return (
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
          项目正在克隆，就绪后即可创建沙箱。
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        选择左侧项目，或新建一个项目开始。
      </div>
    );
  })();

  return (
    <WorkbenchShellView
      groups={groups}
      waitingInputCount={waitingInputCount}
      healthLabel={healthLabel}
      selectedProjectId={selectedProjectId}
      onSelectProject={handleSelectProject}
      onNewProject={() => {
        setCurrentModal('createProject');
      }}
      terminalSlot={mainContent}
    />
  );
}
