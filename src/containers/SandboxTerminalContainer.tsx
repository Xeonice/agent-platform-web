'use client';
// Task 发起主容器：填指令 → 建沙箱 → 拿 id/任务名 → 订阅 /events 推进 status → running 才开终端（10 §7.4）。
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
// provider 档位为**服务端 registry 驱动**（GET /api/providers）：列表项、默认选中、能力位全部来自后端，
// 第三方注册的 provider 无需改前端代码即可出现在选项里。
import { useState } from 'react';
import { useProviders } from '@/hooks/useProviders';
import { useCreateSandbox, useCreateSandboxErrorView } from '@/hooks/useCreateSandbox';
import { useSandboxRestore } from '@/hooks/useSandboxRestore';
import { useTerminalSocketConfig } from '@/hooks/useTerminalSocketConfig';
import { useReportUnauthorized } from '@/hooks/useAccessGate';
import { useAppStore } from '@/stores';
import { NewSandboxPanelView } from '@/views/sandbox/NewSandboxPanel.view';
import { SandboxLifecycleContainer } from '@/containers/SandboxLifecycleContainer';
import { HeadlessTaskContainer } from '@/containers/HeadlessTaskContainer';
import type { SandboxProvider } from '@/types/sandbox';
import { INITIAL_PROMPT_MAX_LENGTH } from '@/types/sandbox';

// S2：projectId 来自选中的真实项目（ready 态才会挂载本容器）；runtime 仍占位（S3 接 runtime）。
const S2_DEFAULT_RUNTIME = 'shell';

/** 已创建的任务：id + **后端派生的**默认任务名（前端不再自己从 prompt 派生一份，T-1）。 */
interface CreatedTask {
  id: string;
  name?: string;
  /** 沙箱的 runtime（S6 无头任务 POST 路径里的 `:rt`）。 */
  runtime?: string;
  /** 沙箱实际落在哪个 provider 档位上（S6 能力位判定）。 */
  provider?: string;
}

export interface SandboxTerminalContainerProps {
  wsBaseUrl: string;
  /** 选中的真实项目（沙箱 /workspace 即该项目文件）。 */
  projectId: string;
}

export function SandboxTerminalContainer({ wsBaseUrl, projectId }: SandboxTerminalContainerProps) {
  // null = 用户尚未手选 → 跟随服务端默认档（前端无默认常量，registry 换默认档即刻生效）。
  const [pickedProvider, setPickedProvider] = useState<SandboxProvider | null>(null);
  const [task, setTask] = useState<CreatedTask | null>(null);
  // ⚠️ 安全红线（15 §3.5）：任务指令**只在本容器的局部 state**，绝不写进 store / persist ——
  // 它可能含仓库路径、内部系统名、业务上下文。提交即清空；后端也**不回显**（10 §7.3），
  // 因此刷新后拿不回来是**有意的**（默认任务名改由后端派生的 name 承接）。
  const [initialPrompt, setInitialPrompt] = useState('');
  const providers = useProviders();
  const createSandbox = useCreateSandbox();
  const createErrorView = useCreateSandboxErrorView(createSandbox.error);
  const { reportRestError } = useReportUnauthorized();
  const setSandboxStatus = useAppStore((s) => s.setSandboxStatus);
  const clearSandboxStatus = useAppStore((s) => s.clearSandboxStatus);
  // 刷新恢复：selectedSandboxId 是 persist 白名单里的字段（15 §3.5），刷新后还在；
  // 本次会话已有 task 时不发这个请求（内存里的状态更新）。
  const persistedSandboxId = useAppStore((s) => s.selectedSandboxId);
  const setSelectedSandboxId = useAppStore((s) => s.setSelectedSandboxId);
  const restoreId = task === null ? persistedSandboxId : null;
  const restored = useSandboxRestore(restoreId);
  const sandboxId = task?.id ?? (restored.notFound ? null : restoreId);
  const taskName = task?.name ?? restored.name;
  // 无头任务打给沙箱自己的 runtime（本会话取创建响应，刷新后取 DTO）。
  const sandboxRuntime = task?.runtime ?? restored.runtime;
  const socketConfig = useTerminalSocketConfig(wsBaseUrl, sandboxId);

  const providerList = providers.data ?? [];
  // 默认档来自数组里 isDefault 的那项（契约把默认档挂在每项上，无顶层字段）。
  // 兜底：registry 非空但没有任何一项 isDefault（属契约异常）→ 取第一项而非留空——
  // 留空会让创建按钮一直禁着、看起来像 bug，取第一项能保住终端这条核心链路且用户仍可改选；
  // 数组为空 → '' → 落到 view 的「后端未注册任何 provider」分支。
  const serverDefault = providerList.find((p) => p.isDefault)?.name ?? providerList[0]?.name ?? '';
  const provider = pickedProvider ?? serverDefault;
  // 选中项的能力位透出到容器层：今天只用 spawnTty 决定终端入口，其余能力位随对象一起交给 view 备用。
  const selectedProvider = providerList.find((p) => p.name === provider);
  const ttyUnsupported = selectedProvider !== undefined && !selectedProvider.capabilities.spawnTty;

  const handleCreate = (): void => {
    // 无可选档位 / 该档位不支持终端时不发请求（按钮已禁用，这里兜住键盘等旁路触发）。
    if (provider === '' || ttyUnsupported) return;
    const prompt = initialPrompt.trim();
    if (Array.from(prompt).length > INITIAL_PROMPT_MAX_LENGTH) return; // 视图已禁用，这里兜旁路触发
    // **提交即清空**（安全红线）：值只在这一刻进入请求体，之后前端不再持有。
    setInitialPrompt('');
    createSandbox.mutate(
      {
        projectId,
        runtime: S2_DEFAULT_RUNTIME,
        provider,
        // 空指令不发字段（后端可选）；非空则随创建请求提交，agent 启动时即执行（T-2）。
        ...(prompt === '' ? {} : { initialPrompt: prompt }),
      },
      {
        onSuccess: (sandbox) => {
          // 种子首值（通常 pending）；随后 /events 的 status_changed 推进到 running 才开终端。
          setSandboxStatus(sandbox.id, sandbox.status, {
            failureCode: sandbox.failureCode,
            failureMessage: sandbox.failureMessage,
          });
          // 任务名直接用后端返回的 name（从 prompt 派生，规则 P21-1 §9）——前端不派生第二份。
          // provider 优先用后端回的（权威），回落到本次选中的档位（openapi 同步前生成类型还没这个字段）。
          setTask({
            id: sandbox.id,
            name: sandbox.name,
            runtime: sandbox.runtime,
            provider: provider === '' ? undefined : provider,
          });
          // 落进 persist 白名单里的选中位 ⇒ 刷新后能靠 DTO 把任务名与失败原因取回来。
          setSelectedSandboxId(sandbox.id);
        },
        // 启用口令时建沙箱会 401 → 置锁弹解锁门（11 §3.1）；健康探针 passcode-exempt 不受影响。
        onError: (error) => {
          reportRestError(error);
        },
      },
    );
  };

  const handleRetry = (): void => {
    if (sandboxId !== null) clearSandboxStatus(sandboxId);
    setTask(null);
    setSelectedSandboxId(null); // 回新建入口 = 不再恢复这个任务（否则刷新又被拉回失败卡）
    createSandbox.reset();
  };

  if (sandboxId === null || socketConfig === null) {
    return (
      <NewSandboxPanelView
        providers={providerList}
        provider={provider}
        onSelectProvider={setPickedProvider}
        onCreate={handleCreate}
        creating={createSandbox.isPending}
        loadingProviders={providers.isPending}
        providersErrorMessage={
          providers.isError ? providers.error.message || '请求失败' : undefined
        }
        onRetryProviders={() => {
          void providers.refetch();
        }}
        createDisabledReason={
          ttyUnsupported
            ? `provider「${provider}」不支持终端（spawnTty=false），请改选其它运行档位。`
            : undefined
        }
        // 两条**互斥**的错误呈现路径（P22 §1 / 04 §5）：
        //  · rejection = 409 能力静态校验，请求在落库前被拒（零副作用，没有 sandbox id、
        //    列表不留 failed 记录）⇒ 就地提示改选，绝不走"创建失败可重试"；
        //  · errorMessage = 其余创建期失败，人话 + 建议。
        rejectionMessage={createErrorView.rejection}
        errorMessage={
          createErrorView.failure === undefined
            ? undefined
            : `${createErrorView.failure.title} —— ${createErrorView.failure.advice}`
        }
        initialPrompt={initialPrompt}
        onInitialPromptChange={setInitialPrompt}
      />
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

  // sessionId 是前端标签身份（≠ 后端下发的 socketSessionKey，08 §11.1）；S1 单标签固定 :0。
  // 交给生命周期门：startup 展示进度、running 才开终端、failed 可重试。
  return (
    <SandboxLifecycleContainer
      sessionId={`${sandboxId}:0`}
      sandboxId={sandboxId}
      socketConfig={socketConfig}
      onRetry={handleRetry}
      taskName={taskName}
      headlessSlot={
        sandboxRuntime === undefined ? undefined : (
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
  );
}
