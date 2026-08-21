'use client';
// S1 主容器：建沙箱 → 拿 id → 订阅 /events 推进 status → running 才开终端（10 §7.4）。
// 唯一 view↔hooks 粘合点；副作用只在 hook（useProviders / useCreateSandbox / events / lifecycle），
// 本层只做编排与本地 UI 态。
// provider 档位为**服务端 registry 驱动**（GET /api/providers）：列表项、默认选中、能力位全部来自后端，
// 第三方注册的 provider 无需改前端代码即可出现在选项里。
import { useState } from 'react';
import { useProviders } from '@/hooks/useProviders';
import { useCreateSandbox } from '@/hooks/useCreateSandbox';
import { useTerminalSocketConfig } from '@/hooks/useTerminalSocketConfig';
import { useReportUnauthorized } from '@/hooks/useAccessGate';
import { useAppStore } from '@/stores';
import { NewSandboxPanelView } from '@/views/sandbox/NewSandboxPanel.view';
import { SandboxLifecycleContainer } from '@/containers/SandboxLifecycleContainer';
import type { SandboxProvider } from '@/types/sandbox';

// S2：projectId 来自选中的真实项目（ready 态才会挂载本容器）；runtime 仍占位（S3 接 runtime）。
const S2_DEFAULT_RUNTIME = 'shell';

export interface SandboxTerminalContainerProps {
  wsBaseUrl: string;
  /** 选中的真实项目（沙箱 /workspace 即该项目文件）。 */
  projectId: string;
}

export function SandboxTerminalContainer({ wsBaseUrl, projectId }: SandboxTerminalContainerProps) {
  // null = 用户尚未手选 → 跟随服务端默认档（前端无默认常量，registry 换默认档即刻生效）。
  const [pickedProvider, setPickedProvider] = useState<SandboxProvider | null>(null);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const providers = useProviders();
  const createSandbox = useCreateSandbox();
  const socketConfig = useTerminalSocketConfig(wsBaseUrl, sandboxId);
  const { reportRestError } = useReportUnauthorized();
  const setSandboxStatus = useAppStore((s) => s.setSandboxStatus);
  const clearSandboxStatus = useAppStore((s) => s.clearSandboxStatus);

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
    createSandbox.mutate(
      { projectId, runtime: S2_DEFAULT_RUNTIME, provider },
      {
        onSuccess: (sandbox) => {
          // 种子首值（通常 pending）；随后 /events 的 status_changed 推进到 running 才开终端。
          setSandboxStatus(sandbox.id, sandbox.status);
          setSandboxId(sandbox.id);
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
    setSandboxId(null);
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
        errorMessage={createSandbox.error?.message}
      />
    );
  }

  // sessionId 是前端标签身份（≠ 后端下发的 socketSessionKey，08 §11.1）；S1 单标签固定 :0。
  // 交给生命周期门：startup 展示进度、running 才开终端、failed 可重试。
  return (
    <SandboxLifecycleContainer
      sessionId={`${sandboxId}:0`}
      sandboxId={sandboxId}
      socketConfig={socketConfig}
      onRetry={handleRetry}
    />
  );
}
