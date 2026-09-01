'use client';
// 工作台容器（S2）：项目列表 → 左侧树；主区 = 只读条 + 内容（终端 / 恢复面板 / 占位）。
// 两个「新建」都是**真弹层**，走 `WorkbenchShellView` 的 `overlaySlot`（F21-2 §N.0）。
// 全局订阅 /events（sandbox 状态 + 项目 clone 进度都靠它推进）；唯一 view↔hooks 粘合点（07 §2）。
//
// ⚠️ **本轮改掉的病根**：`currentModal==='createProject'` 此前被 return 成 `mainContent` ——
// 是主区换页，不是弹层，`currentModal` 这个名字是假的（§N.0）。而「新建任务」连入口都没有，
// 只是 `SandboxTerminalContainer` 在沙箱为空时的兜底渲染。现在两个动作**形态对称**：
// 同一套 overlay、各有显式入口。
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useHealth } from '@/hooks/_shared/useHealth';
import {
  useProjects,
  projectKeys,
  useCancelClone,
  describeProjectActionError,
} from '@/hooks/project/useProjects';
import { useProjectRecovery } from '@/hooks/project/useProjectRecovery';
import { useSyncProject } from '@/hooks/project/useProjectBranches';
import { useProjectTaskTree } from '@/hooks/project/useProjectTaskTree';
import { useSandboxes, sandboxListKeys } from '@/hooks/sandbox/useSandboxes';
import { useSandboxEventsSocket } from '@/hooks/sandbox/useSandboxEventsSocket';
import { useRuntimeAuthSync } from '@/hooks/credential/useRuntimeAuthSync';
import { useEscapeKey } from '@/hooks/_shared/useEscapeKey';
import { useReportUnauthorized } from '@/hooks/access/useAccessGate';
import { useOfflineMode } from '@/hooks/system/useGlobalBanner';
import { useAppStore } from '@/stores';
import { WorkbenchShellView } from '@/views/workbench/WorkbenchShell.view';
import { ModalShellView } from '@/views/common/ModalShell.view';
import { useRouter } from 'next/navigation';
import { useModalFocus } from '@/hooks/_shared/useModalFocus';
import { ProjectInfoBarView } from '@/views/project/ProjectInfoBar.view';
import { SandboxTerminalContainer } from '@/containers/sandbox/SandboxTerminalContainer';
import { NewProjectContainer } from '@/containers/project/NewProjectContainer';
import { ProjectRecoveryContainer } from '@/containers/project/ProjectRecoveryContainer';
import { RetainedVolumesContainer } from '@/containers/project/RetainedVolumesContainer';
import { ProjectMenuContainer } from '@/containers/project/ProjectMenuContainer';
import { ProjectGroupMenuView } from '@/views/project/ProjectGroupMenu.view';
import { AutomationsPanelContainer } from '@/containers/project/AutomationsPanelContainer';
import type { Project, Sandbox } from '@/types/domain';

/**
 * WS 基址。**默认空串 = 同源**，与 `services/api/client.ts` 的 `API_BASE_URL` 对齐。
 *
 * 空串 ⇒ uri 形如 `/terminal`，socket.io 按相对路径解析：补上当前页面的 host 与
 * 协议（`location.protocol` ⇒ https 页面自动 wss），再由 next.config.mjs 的
 * `/socket.io` rewrite 转给后端。
 *
 * ⚠️ 此处**曾经**默认 `'ws://localhost:3001'`，那是开发期后端端口，被烤进生产
 * bundle（实测在 `chunks/app/page-*.js` 里，不是 mock 残留）。绝对地址在这里是
 * 无解的：它是构建期常量，而正确值取决于运行时访问者用的 host。
 *
 * ⚠️ `??` 只对 `undefined`/`null` 回落 —— `.env` 里写 `NEXT_PUBLIC_WS_BASE_URL=`
 * 得到的是**空串**，会正常生效（这正是我们要的），不会掉回默认值。
 */
const WS_BASE_URL = process.env['NEXT_PUBLIC_WS_BASE_URL'] ?? '';

/** 稳定引用：每次渲染新建 [] 会让 useMemo 依赖每次都变。 */
const EMPTY_TASKS: Sandbox[] = [];

export function WorkbenchContainer() {
  const health = useHealth();
  // 离线模式（F21-8 §4「本页唯一持续影响其他页面的输出」）：只读缓存，不发请求。
  const offline = useOfflineMode();
  const projects = useProjects();
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const router = useRouter();
  const setSelectedProjectId = useAppStore((s) => s.setSelectedProjectId);
  const setSelectedSandboxId = useAppStore((s) => s.setSelectedSandboxId);
  const selectedSandboxId = useAppStore((s) => s.selectedSandboxId);
  const currentModal = useAppStore((s) => s.currentModal);
  const setCurrentModal = useAppStore((s) => s.setCurrentModal);
  const selectedProjectForMenu = useAppStore((s) => s.selectedProjectForMenu);
  const setSelectedProjectForMenu = useAppStore((s) => s.setSelectedProjectForMenu);
  const expandProject = useAppStore((s) => s.expandProject);
  const taskListFolds = useAppStore((s) => s.taskListFolds);
  const { reportRestError, reportUnauthorized } = useReportUnauthorized();
  const queryClient = useQueryClient();
  const syncProject = useSyncProject();

  // 全局 /events 订阅：项目 clone 进度在建沙箱之前就要收，故挂在工作台顶层（未授权 → 解锁门）。
  // runtime-auth.status_changed → patch runtime 凭证 Query（横幅/卡片同源刷新，15 §2.3）。
  const syncRuntimeAuth = useRuntimeAuthSync();
  useSandboxEventsSocket({
    base: WS_BASE_URL,
    onUnauthorized: reportUnauthorized,
    onRuntimeAuthChanged: syncRuntimeAuth,
    // 建/销毁/状态变更都要让左侧树跟着动，否则新任务要手动刷新才出现。
    onSandboxChanged: (event) => {
      void queryClient.invalidateQueries({ queryKey: sandboxListKeys.list() });
      // 增删才动项目列表：taskCount 是后端权威计数，不跟着变就会与列表对不上
      // （正是"写着 ·1、展开一条都没有"那个割裂的另一半）。状态变更不影响计数，
      // 每帧都失效项目列表只是白白多打一次请求。
      if (event.event === 'sandbox.created' || event.event === 'sandbox.removed') {
        void queryClient.invalidateQueries({ queryKey: projectKeys.all() });
      }
    },
  });

  // 左侧树的任务：一次拿全部项目的 sandbox（后端 `projectId` 缺省 = 全部，10 §6）。
  // hook 已做 DTO → 领域映射（container 不可 import lib）。
  const sandboxes = useSandboxes();

  // 建流程内确认就绪的项目（clone done / 转空），绕过列表 staleTime 的短暂过期读。
  const [readyProjectId, setReadyProjectId] = useState<string | null>(null);

  // 组头「⋯」下拉当前开在哪个项目上（**瞬时 UI**，不进 store：它连一次刷新都不该活过）。
  const [groupMenuProjectId, setGroupMenuProjectId] = useState<string | null>(null);
  // 从组头菜单的 [删除项目…] 进面板时，直接落在删除确认视图上（同一个确认组件）。
  const [menuOpensOnDelete, setMenuOpensOnDelete] = useState(false);

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
    sandboxes.data ?? EMPTY_TASKS,
    taskListFolds,
    selectedProjectId,
  );

  const selectedProject = projects.data?.find((p) => p.id === selectedProjectId) ?? null;
  const selectedReady =
    selectedProject?.cloneStatus === 'ready' || selectedProjectId === readyProjectId;

  // 组头「⋯」/ 侧弹层指向的项目。**与 selectedProject 是两位**（§9.2 VS-2 步骤 1：
  // 打开 B 的菜单不改当前工作项目）。侧弹层里的已保留卷 / 自动化都以它为作用域。
  const groupMenuProject = projects.data?.find((p) => p.id === groupMenuProjectId) ?? null;
  const menuProject = projects.data?.find((p) => p.id === selectedProjectForMenu) ?? null;

  const healthLabel =
    health.data !== undefined
      ? `后端健康（HTTP ${String(health.data.status)}）`
      : health.isError
        ? '后端不可用'
        : '正在检查后端…';

  const handleSelectProject = (projectId: string): void => {
    setReadyProjectId(null); // 手动切换：就绪判定回到列表口径
    setSelectedProjectId(projectId);
    setGroupMenuProjectId(null);
    setCurrentModal(null);
  };

  const handleProjectReady = (projectId: string): void => {
    setReadyProjectId(projectId);
    setSelectedProjectId(projectId);
    setCurrentModal(null);
    void queryClient.invalidateQueries({ queryKey: projectKeys.all() });
  };

  /**
   * failed 态三出口里的前两项（[重试克隆] / [改为空项目]）。
   *
   * ⚠️ **就是恢复面板用的那一个 hook**（§10.2 A 2026-09-01 裁决）：`useProjectRecovery`
   * 已经把 retry / convertToEmpty / busy / actionError / guidance 统一好了，菜单接上它
   * 是接线，不是重构。⛔ 全仓只许有一处持有 `retry-clone` —— 菜单自己再发一次，
   * 一次点击就会打出两个请求，两处的乐观回退还会互相覆盖。
   */
  const groupMenuRecovery = useProjectRecovery({
    projectId: groupMenuProjectId,
    errorCode: groupMenuProject?.cloneErrorCode,
    onConverted: (projectId) => {
      setGroupMenuProjectId(null);
      handleProjectReady(projectId);
    },
  });
  // 取消克隆（**保留项目**）。与删除是两条路，文案也不能像（§10.6 第 2 条）。
  const cancelClone = useCancelClone();

  // 菜单里唯一一处可见错误：恢复动作（retry/convert）与取消克隆共用一格。
  const groupMenuActionError: string | undefined =
    groupMenuRecovery.actionError ??
    (cancelClone.isError ? describeProjectActionError(cancelClone.error) : undefined);

  /** 组头「⋯」：再点一次收起（没有第二个"关闭菜单"的入口，别让用户找不着北）。 */
  const handleOpenGroupMenu = (projectId: string): void => {
    setGroupMenuProjectId((current) => (current === projectId ? null : projectId));
  };

  /**
   * 组头「⋯」→ 项目菜单侧弹层（§5）。
   * ⚠️ 只置 `selectedProjectForMenu`，**不改 `selectedProjectId`** —— 看 B 的项目菜单
   * 不该把我正在干活的上下文从 A 搬走。
   */
  const handleOpenProjectMenu = (projectId: string, confirmDelete: boolean): void => {
    setGroupMenuProjectId(null);
    setMenuOpensOnDelete(confirmDelete);
    setSelectedProjectForMenu(projectId);
    setCurrentModal('projectMenu');
  };

  const closeModal = (): void => {
    setCurrentModal(null);
    // 弹层关了，指向也就没有意义了（这一位不 persist，留着只会让下一次打开闪一帧旧项目）。
    setSelectedProjectForMenu(null);
    setMenuOpensOnDelete(false);
  };
  // Esc 关「新建项目」弹层（「新建任务」那一个由 SandboxTerminalContainer 自己管——
  // 它的 busy 判据是那边的 mutation.isPending）。
  useEscapeKey(currentModal === 'createProject', closeModal);
  // 焦点移进弹层 + Tab 陷阱 + 关闭还原。缺了它，焦点会留在打开弹窗的那个元素上
  // （这个产品里常常是正在跑的终端）⇒ 用户敲的字进了另一个 agent 的 shell。
  const projectModalRef = useRef<HTMLDivElement>(null);
  useModalFocus(currentModal === 'createProject', projectModalRef);

  // 「已保留卷」弹层同样要 Esc 与焦点陷阱——少给一个，这个弹层就成了"能打开、关不掉"
  // （它里面全是链接与按钮，键盘用户会被困住）。
  const retainedModalRef = useRef<HTMLDivElement>(null);
  useEscapeKey(currentModal === 'retainedVolumes', closeModal);
  useModalFocus(currentModal === 'retainedVolumes', retainedModalRef);

  // 「自动化规则」弹层同理。⚠️ 它内部还有列表/详情/表单三个视图，Esc 关的是**整个弹层**
  // —— 面板内退回上一视图走的是 [返回列表] / [取消]，两条路不混（modal 不堆叠 ⇒
  // Esc 也没有"退一层"的语义可退）。
  const automationsModalRef = useRef<HTMLDivElement>(null);
  useEscapeKey(currentModal === 'automations', closeModal);
  useModalFocus(currentModal === 'automations', automationsModalRef);

  // 「项目菜单」弹层同理。⚠️ 面板内的「详情 ⇄ 删除确认」也是**视图切换**，Esc 关的是
  // 整个弹层——删除确认取消走的是面板内的 [取消]。
  const projectMenuModalRef = useRef<HTMLDivElement>(null);
  useEscapeKey(currentModal === 'projectMenu', closeModal);
  useModalFocus(currentModal === 'projectMenu', projectMenuModalRef);

  // 组头「⋯」下拉：Esc 收起。它不是弹层（没有遮罩、不夺焦点），所以只接 Esc 这一条。
  useEscapeKey(groupMenuProjectId !== null, () => {
    setGroupMenuProjectId(null);
  });

  /**
   * [+ 新任务] 的可用性（§9.1 #33）。
   *
   * **无选中项目不可进入**：绕过会建出无项目归属的 Task。克隆中 / 克隆失败的项目同理——
   * 工作区还不存在，建出来的沙箱没有 /workspace 可挂。
   */
  const newTaskDisabledReason =
    // ⚠️ **离线排在最前**（P21-8 §7 置灰清单）：另外两条是"换个项目就能发起"，
    //    而离线时换哪个项目都发不出去。把它排在后面，用户会照着"先选中一个项目"
    //    去点，选完发现按钮还是灰的，而理由换成了一句他刚刚照做过的话。
    //    ⚠️ 判定与 🔴 横幅**同源**（`useOfflineMode`）：分开各算一份时，会出现
    //    "红条说 Agent 不可用、[+ 新任务] 照样能点"。
    offline.disabledReason ??
    (selectedProject === null
      ? '先在左侧选中一个项目'
      : !selectedReady
        ? '项目尚未就绪（克隆完成后可发起）'
        : undefined);

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

  /**
   * 项目只读条（F21-6 §9.2）：主区**顶部**一条，不新开页面。
   * 只回答"我在拿什么代码干活"——改远端 / 切默认分支都**不在这条上**；唯一的动作是 [重新同步]。
   *
   * ★ [🎁 已保留卷] / [⚙️ 自动化规则] 已搬进 `ProjectMenuPanel`（组头「⋯」→ 项目菜单，
   * F21-6 §10.2 C）。这条自此回到**纯只读**。
   *
   * ⏳ 四个字段（repoUrl / repoBranch / baselineSizeBytes / updatedAt）等后端契约同步；
   * 缺席时逐格降级为 `—`，**条本身照常渲染**（见 types/project.ts 的说明）。
   */
  const infoBar =
    selectedProject === null ? null : (
      <ProjectInfoBarView
        projectName={selectedProject.name}
        sourceType={selectedProject.sourceType}
        repoUrl={selectedProject.repoUrl}
        repoBranch={selectedProject.repoBranch}
        baselineSizeBytes={selectedProject.baselineSizeBytes}
        updatedAt={selectedProject.updatedAt}
        createdAt={selectedProject.createdAt}
        // 仅 ready 态（§9.3）：克隆中/失败各有自己的出口，谈不上"重新同步"。
        canSync={selectedProject.cloneStatus === 'ready'}
        syncing={syncProject.isPending}
        // 人话由 hook 按 code 查表给出（10A E-5）——此前这里直接渲染 envelope.message,
        // 而那是 sanitizeCloneMessage(git stderr),一行英文报错。
        {...(syncProject.errorMessage === undefined
          ? {}
          : { syncErrorMessage: syncProject.errorMessage })}
        syncNeedsCredentials={syncProject.needsCredentials}
        onConfigureCredentials={() => {
          router.push('/settings/credentials');
        }}
        onSync={() => {
          syncProject.sync(selectedProject.id);
        }}
      />
    );

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
      onNewTask={() => {
        setCurrentModal('newTask');
      }}
      newTaskDisabledReason={newTaskDisabledReason}
      currentProjectName={selectedProject?.name ?? null}
      // 指示器点击 = **只做树内定位展开**（§5）：不开下拉、不承载创建/管理入口。
      onLocateCurrentProject={() => {
        if (selectedProjectId !== null) expandProject(selectedProjectId);
      }}
      openMenuProjectId={groupMenuProjectId}
      onOpenGroupMenu={handleOpenGroupMenu}
      groupMenuSlot={
        groupMenuProject === null ? undefined : (
          <ProjectGroupMenuView
            projectName={groupMenuProject.name}
            cloneStatus={groupMenuProject.cloneStatus}
            busy={groupMenuRecovery.busy || cancelClone.isPending}
            {...(groupMenuActionError === undefined ? {} : { actionError: groupMenuActionError })}
            onOpenPanel={() => {
              handleOpenProjectMenu(groupMenuProject.id, false);
            }}
            // ⚠️ 这两个直接是恢复面板那一个 hook 的方法（§10.2 A），⛔ 不在这里另发请求。
            onRetryClone={groupMenuRecovery.retry}
            onConvertToEmpty={groupMenuRecovery.convertToEmpty}
            onCancelClone={() => {
              // ⛔ 不乐观收起菜单：失败了要在原地把原因说出来（与删除 409 同一条纪律）。
              cancelClone.mutate(groupMenuProject.id, {
                onSuccess: () => {
                  setGroupMenuProjectId(null);
                },
              });
            }}
            onRequestDelete={() => {
              // 删除确认只有一处实现：进同一个侧弹层，直接落在确认视图上。
              handleOpenProjectMenu(groupMenuProject.id, true);
            }}
          />
        )
      }
      selectedTaskId={selectedSandboxId}
      onSelectTask={(taskId) => {
        // 点任务要同时定位到它所属项目：主区的终端挂在 selectedProject 上，
        // 只设 sandboxId 的话任务行点了没反应（主区停在"选择左侧项目"空态）。
        const owner = (sandboxes.data ?? []).find((t) => t.id === taskId);
        if (owner) setSelectedProjectId(owner.projectId);
        setSelectedSandboxId(taskId);
      }}
      terminalSlot={
        <>
          {infoBar}
          <div className="min-h-0 flex-1">{mainContent}</div>
        </>
      }
      overlaySlot={
        <>
          {currentModal === 'createProject' && (
            <ModalShellView
              shellRef={projectModalRef}
              title="新建项目"
              onClose={closeModal}
              testId="modal-new-project"
            >
              <NewProjectContainer onProjectReady={handleProjectReady} onCancel={closeModal} />
            </ModalShellView>
          )}
          {currentModal === 'projectMenu' && menuProject !== null && (
            <ModalShellView
              shellRef={projectMenuModalRef}
              title="项目菜单"
              subtitle={menuProject.name}
              onClose={closeModal}
              testId="modal-project-menu"
            >
              <ProjectMenuContainer
                projectId={menuProject.id}
                projectName={menuProject.name}
                cloneStatus={menuProject.cloneStatus}
                taskCount={menuProject.taskCount}
                createdAt={menuProject.createdAt}
                initialConfirmingDelete={menuOpensOnDelete}
                onOpenRetainedVolumes={() => {
                  // modal 不堆叠：换 `currentModal` 的值，本面板随之关闭（§10.5）。
                  setCurrentModal('retainedVolumes');
                }}
                onOpenAutomations={() => {
                  setCurrentModal('automations');
                }}
                onDeleted={() => {
                  // 选中态的清理在 `useDeleteProject` 里（§10.6 第 1 条）：这里只负责关面板。
                  closeModal();
                }}
              />
            </ModalShellView>
          )}
          {currentModal === 'automations' && menuProject !== null && (
            <ModalShellView
              shellRef={automationsModalRef}
              title="自动化规则"
              subtitle={`在 ${menuProject.name} 中`}
              onClose={closeModal}
              testId="modal-automations"
            >
              <AutomationsPanelContainer
                projectId={menuProject.id}
                onOpenTask={(sandboxId) => {
                  // F21-7 §5「[打开 Task]」：关面板 → 工作台选中该 Task。
                  // 右侧渲染只读输出面板由 F21-1 负责，本页只负责跳转。
                  setCurrentModal(null);
                  setSelectedSandboxId(sandboxId);
                }}
              />
            </ModalShellView>
          )}
          {currentModal === 'retainedVolumes' && menuProject !== null && (
            <ModalShellView
              shellRef={retainedModalRef}
              title="已保留卷"
              subtitle={`在 ${menuProject.name} 中`}
              onClose={closeModal}
              testId="modal-retained-volumes"
            >
              <RetainedVolumesContainer projectId={menuProject.id} projectName={menuProject.name} />
            </ModalShellView>
          )}
        </>
      }
    />
  );
}
