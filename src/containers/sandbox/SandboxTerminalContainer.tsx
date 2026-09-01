'use client';
// Task 发起主容器：[+ 新任务] 开**弹层** → 填指令 → 建沙箱 → 拿 id/任务名 → 订阅 /events
// 推进 status → running 才开终端（10 §7.4）。
// 唯一 view↔hooks 粘合点；副作用只在 hook（useProviders / useCreateSandbox / events / lifecycle），
// 本层只做编排与本地 UI 态。
//
// S5 语义（TASK-LAUNCH-DECISIONS T-1/T-2）：
//  · 任务指令随创建请求提交并**落后端库**，agent 会话由后端在 provision 的「启动实例」阶段起好并开始执行——
//    终端不再是"开工开关"，打开终端只是 attach 已存在的会话；
//  · 指令只在**本容器局部 state**（安全红线 15 §3.5），提交即清空；后端不回显，刷新拿不回来是**有意的**；
//  · 默认任务名由后端从指令派生（`SandboxDto.name`），前端直接用、不派生第二份；
//  · 失败原因两条通道：WS `status_changed.errorCode`（即时）+ DTO `failureCode`（刷新恢复，
//    经持久化的 selectedSandboxId → useSandboxRestore 拉回来）。
// provider 档位与 runtime **都是服务端 registry 驱动**（GET /api/providers、GET /api/runtimes）：
// 列表项与能力位全部来自后端，第三方注册的 provider / runtime 无需改前端代码即可出现在选项里。
// 默认选中只有 provider 一侧有（DTO 里的 `isDefault`，服务端**明说**的默认档）；runtime 一侧
// **必选、不预选**（04 §8：平台没有「默认 runtime」概念）——详见下面 `runtime` 处的注释。
//
// ⚠️ runtime 这一半是补上来的（14 §10）：S2 时期这里写着 `const S2_DEFAULT_RUNTIME = 'shell'`，
// 而后端注册表里只有 codex / claude-code ⇒ 从这个入口建的沙箱**必然**死在 `unknown runtime 'shell'`。
// 类型层拦不住（契约是 `runtime: z.string().min(1)`，开放集**故意**不收窄），
// 正确的防线只有"注册表驱动 UI + 前端不出现任何字面量默认值"这一条 —— 就是本文件现在的形状。
import { useCallback, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useProviders } from '@/hooks/sandbox/useProviders';
import { useRuntimes } from '@/hooks/credential/useRuntimes';
import { useCreateSandbox, useCreateSandboxErrorView } from '@/hooks/sandbox/useCreateSandbox';
import { useSandboxRestore } from '@/hooks/sandbox/useSandboxRestore';
import { useTerminalSocketConfig } from '@/hooks/terminal/useTerminalSocketConfig';
import { useProjectBranches } from '@/hooks/project/useProjectBranches';
import { useEscapeKey } from '@/hooks/_shared/useEscapeKey';
import { readNewTaskDeepLink } from '@/hooks/_shared/useDeepLinkModal';
import { useReportUnauthorized } from '@/hooks/access/useAccessGate';
import { useAppStore } from '@/stores';
import { NewSandboxPanelView } from '@/views/sandbox/NewSandboxPanel.view';
import { ModalShellView } from '@/views/common/ModalShell.view';
import { useModalFocus } from '@/hooks/_shared/useModalFocus';
import { AuthGateContainer } from '@/containers/credential/AuthGateContainer';
import { invalidateRuntimeAuth } from '@/hooks/credential/useRuntimeAuthMutations';
import { SandboxLifecycleContainer } from '@/containers/sandbox/SandboxLifecycleContainer';
import { HeadlessTaskContainer } from '@/containers/task/HeadlessTaskContainer';
import { INITIAL_PROMPT_MAX_LENGTH } from '@/types/sandbox';
import type { ProjectSourceType } from '@/types/project';

/**
 * 深链进来时挂在指令框下的那句话（F21-2 §2.1）。⛔ 不许省：深链恢复的是「弹窗打开 +
 * 项目上下文」，**不是用户输入**——不说这一句，用户会以为自己写的指令也还在。
 */
const DEEP_LINK_PROMPT_NOTICE = '刷新后指令未保留，请重新输入';

/** 已创建的任务：id + **后端派生的**默认任务名（前端不再自己从 prompt 派生一份，T-1）。 */
interface CreatedTask {
  id: string;
  name?: string;
  /** 沙箱的 runtime（S6 无头任务 POST 路径里的 `:rt`）。 */
  runtime?: string;
  /** 沙箱实际落在哪个 provider 档位上（S6 能力位判定）。 */
  provider?: string;
  /** 模式：`true` = 无头任务，`false` = 交互式终端（创建时二选一，P20 §3.2）。 */
  headless?: boolean;
}

export interface SandboxTerminalContainerProps {
  wsBaseUrl: string;
  /** 选中的真实项目（沙箱 /workspace 即该项目文件）。 */
  projectId: string;
  /** 项目名：弹窗上下文用（弹窗内**没有**项目下拉，归属继承左侧树选中项，§9.0）。 */
  projectName: string;
  /** 项目来源：`'empty'` ⇒ 没有 git ⇒ **不渲染分支选择器、也不发 /branches 请求**。 */
  projectSourceType: ProjectSourceType;
}

export function SandboxTerminalContainer({
  wsBaseUrl,
  projectId,
  projectName,
  projectSourceType,
}: SandboxTerminalContainerProps) {
  // null = 用户尚未手选 → 跟随服务端默认档（前端无默认常量，registry 换默认档即刻生效）。
  // runtime 一侧：null = **用户还没选**（平台没有默认 runtime 概念，既不预选也不猜）。
  const [pickedRuntime, setPickedRuntime] = useState<string | null>(null);
  const [task, setTask] = useState<CreatedTask | null>(null);
  // ⚠️ 安全红线（15 §3.5）：任务指令**只在本容器的局部 state**，绝不写进 store / persist ——
  // 它可能含仓库路径、内部系统名、业务上下文。提交即清空；后端也**不回显**（10 §7.3），
  // 因此刷新后拿不回来是**有意的**（默认任务名改由后端派生的 name 承接）。
  const [initialPrompt, setInitialPrompt] = useState('');
  /**
   * 所选分支；`''` = **没选**。
   *
   * ⚠️ 没选**不是**缺省值缺失：分支有天然缺省（基线当前分支），与"平台没有默认 runtime"
   * 那条恰好相反（04 §8）。所以这里既不预填 `'main'`，也不在提交时补一个值 ——
   * `''` 时请求体**不含** `branch` 字段，由后端走缺省（§9.4 ④）。
   */
  const [branch, setBranch] = useState('');
  const providers = useProviders();
  const runtimes = useRuntimes();
  const isGitProject = projectSourceType === 'git';
  // 空项目不发这个请求（enabled:false）——没有 git，谈不上分支。
  const branches = useProjectBranches({ projectId, isGitProject });
  const createSandbox = useCreateSandbox();
  const createErrorView = useCreateSandboxErrorView(createSandbox.error);
  const { reportRestError } = useReportUnauthorized();
  const setSandboxStatus = useAppStore((s) => s.setSandboxStatus);
  const clearSandboxStatus = useAppStore((s) => s.clearSandboxStatus);
  // 弹层开关（真 overlay，不再是"沙箱为空时的兜底渲染"，§N.0）。入口在工作台 [+ 新任务]。
  const currentModal = useAppStore((s) => s.currentModal);
  const setCurrentModal = useAppStore((s) => s.setCurrentModal);
  /**
   * 这一次的弹窗是**深链带出来的**，还是站内点开的？（F21-2 §2.1 裁决一）
   *
   * 判据是「本容器挂载的那一刻，URL 上的 `?new=1&project=` 正指着**我这个项目**」：
   *   · 深链进入 —— `useNewTaskDeepLink` 先把项目选中、把弹窗打开，容器随之挂载，
   *     这时 URL 上的参数还在 ⇒ true；
   *   · 站内点开 —— 容器在用户选中项目时就已经挂载（早于点 [＋ 新任务]），
   *     那一刻 URL 是干净的 ⇒ false。参数是点开之后才被 hook 写上去的，追不回来。
   * 比较 `projectId` 是必需的：切项目时旧弹窗的参数可能还没被抹掉，不比对就会误判。
   *
   * ⚠️ 只读一次（`useState` 初值），**不是每帧读 URL**：弹窗一打开 URL 就有参数了，
   * 每帧读的话站内点开也会在下一帧翻成 true，那句灰字就会到处乱冒。
   */
  const [openedFromDeepLink, setOpenedFromDeepLink] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      readNewTaskDeepLink(window.location.search)?.projectId === projectId,
  );
  // 弹窗一旦关上，这次"深链会话"就结束了：之后在同一个容器上重新点开 [＋ 新任务]
  // 属于**站内点开**，不该再挂那句「刷新后指令未保留」。
  const modalWasOpen = useRef(currentModal === 'newTask');
  useEffect(() => {
    const open = currentModal === 'newTask';
    if (modalWasOpen.current && !open) setOpenedFromDeepLink(false);
    modalWasOpen.current = open;
  }, [currentModal]);
  // 刷新恢复：selectedSandboxId 是 persist 白名单里的字段（15 §3.5），刷新后还在；
  // 本次会话已有 task 时不发这个请求（内存里的状态更新）。
  const persistedSandboxId = useAppStore((s) => s.selectedSandboxId);
  const setSelectedSandboxId = useAppStore((s) => s.setSelectedSandboxId);
  const restoreId = task === null ? persistedSandboxId : null;
  const restored = useSandboxRestore(restoreId, projectId);
  const sandboxId = task?.id ?? (restored.notFound ? null : restoreId);
  const taskName = task?.name ?? restored.name;
  // 无头任务打给沙箱自己的 runtime（本会话取创建响应，刷新后取 DTO）。
  const sandboxRuntime = task?.runtime ?? restored.runtime;
  const socketConfig = useTerminalSocketConfig(wsBaseUrl, sandboxId);

  const providerList = providers.data ?? [];
  /**
   * 后端为**这台宿主**选定的档位（`isDefault` 那项）。前端**只读**，不再让用户选：
   * aio 是 docker 容器、boxlite 是微 VM，哪个跑得起来是宿主平台的事实而不是用户偏好
   * （见 `provider-registry.ts` 的 `hostPreferredProvider`）。
   *
   * ⚠️ 兜底取第一项是为了「registry 非空但没有任何一项 isDefault」这种**契约异常**仍能
   * 保住终端这条核心链路。它现在更不该发生了——后端 boot 时就 fail fast——但留着无害。
   * 数组为空 ⇒ `undefined` ⇒ view 出「后端未注册任何沙箱运行环境」并禁用创建。
   */
  const hostProvider = providerList.find((p) => p.isDefault) ?? providerList[0];
  // 能力位透出到容器层：今天只用 spawnTty 决定终端入口。
  const ttyUnsupported = hostProvider !== undefined && !hostProvider.capabilities.spawnTty;

  const runtimeList = runtimes.data ?? [];
  /**
   * **平台没有「默认 runtime」这个概念**（04 §8：`CreateSandbox.runtime` 必填，后端没有任何
   * 回退逻辑）⇒ 前端也不预选。`''` = 用户还没选，按钮禁着，view 就地提示"请选择"。
   *
   * ⚠️ 上一版拿"注册表返回顺序的**第一项**"当默认，并把它叫作"服务端默认"。它不是：
   * registry 的顺序只是**注册顺序**，没有任何一方声明过它表达默认。拿它替用户做一个必填
   * 选择，等于替他挑了一个 agent CLI（codex 还是 claude-code 是完全不同的东西），
   * 而他可能根本没看过那个列表——第三方模块换个加载次序，默认值就悄悄换了人。
   *
   * 与 provider 一侧的对照恰好说明分界：`ProviderResponseDto` **有** `isDefault`，那是服务端
   * **明说**的默认档，跟着走是对的；runtime 侧没有这个字段，**也不会有**——后端裁决：
   * 造一个只能是"注册表第一项"，那是把同一份顺序耦合搬到服务端、再盖上契约的章。
   * 所以正确形状是「必选、不预选」，而不是换个地方猜。
   */
  const runtime = pickedRuntime ?? '';

  /**
   * 鉴权拦截层（P20 §5.1 三分支判定）。**判据是 `GET /api/runtimes` 下发的
   * `credentialStatus`**,前端不自己维护凭证状态。
   *
   *   ① active / expiring  → 不出闸门,给一句正面确认"将以 x 身份运行";
   *   ② none               → 无编号拦截面板 + 一次性语义文案,配置完才能发起;
   *   ③ expired            → 同②的面板,但先说清"已过期",走的是同一条重授权流。
   *
   * ⚠️ 这一层此前**从未接线**。`AuthGateContainer` 的注释写着"向导拦截面板与凭证页
   * 卡片内嵌共用",它甚至备好了两个**只给向导用**的 prop(`showOneTimeNotice` /
   * `onOpenCredentials`)——而生产代码里零调用方,只有 storybook 在传。于是链路是:
   * 前端不看 credentialStatus → 直接建沙箱 → 后端注入时发现没凭证 → 记一条
   * `NO_CREDENTIAL` 的 WARN 然后让 agent 裸跑 → 用户在终端里撞见 CLI 自己的登录菜单,
   * 而平台从头到尾没提示过一句。`expiring` 不拦是有意的:它仍然能用,属于黄色预警态
   * (P21 §2.2),拦下来等于把"还有一周到期"当成"现在不能用"。
   */
  const selectedRuntimeDto = runtimeList.find((r) => r.id === runtime);
  const credentialStatus = selectedRuntimeDto?.credentialStatus;
  const authBlocked = credentialStatus === 'none' || credentialStatus === 'expired';
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleCreate = (): void => {
    // 无可选档位 / 无可选 runtime / 该档位不支持终端时不发请求（按钮已禁用，这里兜住键盘等旁路触发）。
    // 与上面三条同理:按钮已禁用,这里兜住键盘等旁路触发。今天按钮是原生
    // `<button disabled>`(挡得住一切激活路径),但同函数里其余三条都兜了,少这一条
    // 只是等着某天换成自定义控件时变成真口子。
    if (hostProvider === undefined || runtime === '' || ttyUnsupported || authBlocked) return;
    const prompt = initialPrompt.trim();
    if (Array.from(prompt).length > INITIAL_PROMPT_MAX_LENGTH) return; // 视图已禁用，这里兜旁路触发
    // **提交即清空**（安全红线）：值只在这一刻进入请求体，之后前端不再持有。
    setInitialPrompt('');
    createSandbox.mutate(
      {
        projectId,
        // 取自 GET /api/runtimes 的真实注册键（用户可改选）——前端不再有任何 runtime 字面量。
        runtime,
        // ⚠️ **刻意不传 `provider`**（契约里它是 optional）：档位由后端按宿主平台决定，
        //    前端传一份等于让「选哪个」有第二个知情者，两处迟早不一致。
        // 空指令不发字段（后端可选）；非空则随创建请求提交，agent 启动时即执行（T-2）。
        ...(prompt === '' ? {} : { initialPrompt: prompt }),
        // **不选就不带**（§9.4 ④）：缺省 = 基线当前分支，由后端裁决。
        // 前端填一个值等于把"跟随基线"偷偷变成"锁死在某个分支上"。
        ...(branch === '' ? {} : { branch }),
      },
      {
        onSuccess: (sandbox) => {
          // 种子首值（通常 pending）；随后 /events 的 status_changed 推进到 running 才开终端。
          setSandboxStatus(sandbox.id, sandbox.status, {
            failureCode: sandbox.failureCode,
            failureMessage: sandbox.failureMessage,
          });
          // 任务名直接用后端返回的 name（从 prompt 派生，规则 P21-1 §9）——前端不派生第二份。
          // provider 取**后端回的**——它才知道这次真的落在哪个档位上（前端已不再参与选择）。
          setTask({
            id: sandbox.id,
            name: sandbox.name,
            runtime: sandbox.runtime,
            provider: sandbox.provider,
            headless: sandbox.headless,
          });
          // 落进 persist 白名单里的选中位 ⇒ 刷新后能靠 DTO 把任务名与失败原因取回来。
          setSelectedSandboxId(sandbox.id);
          // 创建**受理**即关弹窗：进度卡在主区继续推进（§6「创建中」那一格就在主区）。
          // 失败/门口拒绝时弹窗**留着**——那两条都要求"就地提示改配置"。
          setCurrentModal(null);
        },
        // 启用口令时建沙箱会 401 → 置锁弹解锁门（11 §3.1）；健康探针 passcode-exempt 不受影响。
        onError: (error) => {
          reportRestError(error);
        },
      },
    );
  };

  /**
   * 关弹窗。**指令随之清空**（15 §3.5 安全红线的自然延伸：它可能含仓库路径与业务上下文，
   * 关掉弹窗之后前端没有任何理由继续持有它），并把上一次的创建错误一并 reset ——
   * 否则重开弹窗会先看见一条上次的红字。
   */
  const handleCloseModal = useCallback((): void => {
    setInitialPrompt('');
    createSandbox.reset();
    setCurrentModal(null);
  }, [createSandbox, setCurrentModal]);

  // Esc 关弹窗（与 [✕] / [取消] 同一个动作）；创建中不响应，免得误关。
  useEscapeKey(currentModal === 'newTask' && !createSandbox.isPending, handleCloseModal);
  // 同上：焦点必须移进弹层，否则打字会进正在跑的终端（实测复现过）。
  const taskModalRef = useRef<HTMLDivElement>(null);
  useModalFocus(currentModal === 'newTask', taskModalRef);

  const handleRetry = (): void => {
    if (sandboxId !== null) clearSandboxStatus(sandboxId);
    setTask(null);
    setSelectedSandboxId(null); // 回新建入口 = 不再恢复这个任务（否则刷新又被拉回失败卡）
    createSandbox.reset();
  };

  /**
   * 「新建任务」弹层（§N.1 单弹窗一屏：runtime / provider / 分支 / 指令）。
   *
   * ⚠️ 它**不再是兜底渲染**。此前这份面板由 `sandboxId===null || socketConfig===null`
   * 这个条件"自己出现"——于是"创建"根本不是一个动作，也没有任何入口（§N.0）。
   * 现在它由 `currentModal==='newTask'` 打开，入口在工作台 [+ 新任务]，
   * 并且**在沙箱已经跑起来时同样能打开**（一个项目可以有多个任务）。
   *
   * ⚠️ 鉴权闸门仍然在 `authGateSlot` 里**就地展开**：不跳步、不新开弹层
   *（那两步壳从来就不存在，§3）。
   */
  const newTaskModal =
    currentModal !== 'newTask' ? null : (
      <ModalShellView
        shellRef={taskModalRef}
        title="新建任务"
        subtitle={`在「${projectName}」中发起`}
        onClose={handleCloseModal}
        busy={createSandbox.isPending}
        testId="modal-new-task"
      >
        <NewSandboxPanelView
          runtimes={runtimeList}
          runtime={runtime}
          onSelectRuntime={setPickedRuntime}
          loadingRuntimes={runtimes.isPending}
          runtimesErrorMessage={runtimes.isError ? runtimes.error.message || '请求失败' : undefined}
          onRetryRuntimes={() => {
            void runtimes.refetch();
          }}
          hostProvider={hostProvider}
          onCreate={handleCreate}
          creating={createSandbox.isPending}
          loadingProviders={providers.isPending}
          providersErrorMessage={
            providers.isError ? providers.error.message || '请求失败' : undefined
          }
          onRetryProviders={() => {
            void providers.refetch();
          }}
          authGateSlot={
            authBlocked && selectedRuntimeDto !== undefined ? (
              <AuthGateContainer
                runtimeId={selectedRuntimeDto.id}
                runtimeName={selectedRuntimeDto.displayName}
                methods={selectedRuntimeDto.authMethods}
                // 一次性语义文案只在"从未配置"那支出现;已过期是**再来一次**,那句
                //「只需配置一次」在这里是假话(P20 §5.1 分支③走同一面板但说法不同)。
                showOneTimeNotice={credentialStatus === 'none'}
                onOpenCredentials={() => {
                  router.push('/settings/credentials');
                }}
                // 配置成功 ⇒ 让 runtimes 列表重取,`credentialStatus` 翻成 active 后
                // 闸门自行消失、发起按钮解禁。不在本层记任何凭证态(单一来源在服务端)。
                onSuccess={() => {
                  invalidateRuntimeAuth(queryClient);
                }}
              />
            ) : undefined
          }
          runtimeIdentityNotice={
            credentialStatus === 'active' || credentialStatus === 'expiring'
              ? `将以 ${selectedRuntimeDto?.maskedIdentifier ?? '已配置凭证'} 身份运行${
                  credentialStatus === 'expiring' ? '（凭证即将到期，建议尽快重新授权）' : ''
                }`
              : undefined
          }
          createDisabledReason={
            // ⚠️ 原文案是「请改选其它运行档位」——**现在用户改不了了**（档位由宿主平台决定）。
            //    一条指向不存在的操作的提示，比不提示更贵：它让人在界面上找一个不存在的开关。
            ttyUnsupported
              ? `当前宿主的运行档位「${hostProvider.name}」不支持终端（spawnTty=false）。` +
                '档位由平台按宿主环境选定，不能在这里更改；可以改用**无头任务**（不开终端，agent 启动即执行）。'
              : undefined
          }
          // 两条**互斥**的错误呈现路径（P22 §1 / 04 §5）：
          //  · rejection = 后端显式标了 `sideEffectFree` 的门口拒绝，请求在落库前被拒（没有
          //    sandbox id、列表不留 failed 记录）⇒ 就地提示改配置，绝不走"创建失败可重试"。
          //    ⚠️ 判据不是 HTTP 码：这六条拒绝散在 400/404/409 上，反推必漏（见 lib 里的注释）；
          //  · errorMessage = 其余创建期失败（含后端**漏标**时的保守回落），人话 + 建议。
          rejectionMessage={createErrorView.rejection}
          errorMessage={
            createErrorView.failure === undefined
              ? undefined
              : `${createErrorView.failure.title} —— ${createErrorView.failure.advice}`
          }
          initialPrompt={initialPrompt}
          onInitialPromptChange={setInitialPrompt}
          // 深链把弹窗与项目上下文恢复回来了，**但指令没有**（它只在这个容器的局部
          // state 里，既不进 URL 也不进 localStorage，15 §3.5）。所以要**明说**一句——
          // 用户看见弹窗还在，会默认自己写的东西也还在。站内点开时不给这句。
          {...(openedFromDeepLink ? { promptNotice: DEEP_LINK_PROMPT_NOTICE } : {})}
          // —— 分支选择器（§N.1）——
          // 空项目**整块不渲染**（没有 git，谈不上分支）；加载失败只降级、不拦创建。
          showBranchPicker={isGitProject}
          branches={branches.branches}
          branch={branch}
          onSelectBranch={setBranch}
          loadingBranches={branches.isPending}
          branchesErrorMessage={branches.isError ? '读取本地引用失败' : undefined}
          projectName={projectName}
          onCancel={handleCloseModal}
        />
      </ModalShellView>
    );

  if (sandboxId === null || socketConfig === null) {
    return (
      <>
        {newTaskModal}
        <div
          data-testid="no-sandbox-placeholder"
          className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground"
        >
          <p>「{projectName}」下还没有任务。</p>
          <p>点左侧 [＋ 新任务] 发起一个 —— 填了指令，agent 启动时即执行。</p>
        </div>
      </>
    );
  }

  // S6 能力位（headlessTask）判定：`SandboxResponseDto.provider` 已由后端补上 ⇒
  // **刷新后也能精确判定**，不再有"未知不置灰"的退化路径。
  // 仍可能为 null 的唯一情形：registry 还没加载完 / 该档位已从 registry 卸载。
  const sandboxProvider = task?.provider ?? restored.provider;
  const headlessProvider =
    sandboxProvider === undefined
      ? undefined
      : providerList.find((p) => p.name === sandboxProvider);
  const headlessTaskSupported = headlessProvider?.capabilities.headlessTask ?? null;

  /**
   * ★ 无头面板**只挂在无头沙箱底下**。
   *
   * 此前它对每个沙箱无条件渲染（只判断 runtime 已知），于是**交互式**沙箱底下也挂着
   * 一条「无头任务」。那条永远停在空态说"这个沙箱还没有任务"——因为交互式沙箱根本
   * 不会有无头运行，它的 AgentTask 列表恒为空。
   *
   * 而界面上另一处也叫"任务"：左侧树的 `项目 · N` 数的是 **Sandbox**（Task 的产品叫法，
   * 名字就是用户填的指令）。于是同一屏上出现"· 1"和"还没有任务"直接打架——两句话
   * 各自都对，说的却是两个东西。
   *
   * 模式是创建时**二选一**的（P20 §3.2「◉ 交互式终端 / ○ 无头任务」，`SandboxDto.headless`）。
   * 交互式沙箱的全部界面就是终端本身，底下不该再挂任何东西。
   */
  const sandboxHeadless = task?.headless ?? restored.headless;

  // sessionId 是前端标签身份（≠ 后端下发的 socketSessionKey，08 §11.1）；S1 单标签固定 :0。
  // 交给生命周期门：startup 展示进度、running 才开终端、failed 可重试。
  //
  // ⚠️ 弹层与主区**并存**：沙箱已经跑起来时照样能开「新建任务」——一个项目多个任务是
  // 数据模型本来的样子，把入口藏起来等于把这个能力从界面上抹掉（同 §N.3 对无头面板的裁决）。
  return (
    <>
      {newTaskModal}
      <SandboxLifecycleContainer
        sessionId={`${sandboxId}:0`}
        sandboxId={sandboxId}
        socketConfig={socketConfig}
        onRetry={handleRetry}
        taskName={taskName}
        headlessSlot={
          sandboxRuntime === undefined || sandboxHeadless !== true ? undefined : (
            <HeadlessTaskContainer
              sandboxId={sandboxId}
              runtime={sandboxRuntime}
              wsBaseUrl={wsBaseUrl}
              headlessTaskSupported={headlessTaskSupported}
              providerName={sandboxProvider}
            />
          )
        }
      />
    </>
  );
}
