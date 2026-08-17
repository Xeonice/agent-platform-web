'use client';
// S1 主容器：建沙箱 → 拿 id → 订阅 /events 推进 status → running 才开终端（10 §7.4）。
// 唯一 view↔hooks 粘合点；副作用只在 hook（useCreateSandbox / events / lifecycle），本层只做编排与本地 UI 态。
import { useState } from 'react';
import { useCreateSandbox } from '@/hooks/useCreateSandbox';
import { useTerminalSocketConfig } from '@/hooks/useTerminalSocketConfig';
import { useReportUnauthorized } from '@/hooks/useAccessGate';
import { useAppStore } from '@/stores';
import { NewSandboxPanelView } from '@/views/sandbox/NewSandboxPanel.view';
import { SandboxLifecycleContainer } from '@/containers/SandboxLifecycleContainer';
import { SANDBOX_PROVIDERS, DEFAULT_SANDBOX_PROVIDER, type SandboxProvider } from '@/types/sandbox';

// S1 范围：不做项目/runtime 选择。projectId/runtime 用占位默认（S2 接项目、S3 接 runtime）。
const S1_DEFAULT_PROJECT_ID = 'default';
const S1_DEFAULT_RUNTIME = 'shell';

export interface SandboxTerminalContainerProps {
  wsBaseUrl: string;
}

export function SandboxTerminalContainer({ wsBaseUrl }: SandboxTerminalContainerProps) {
  const [provider, setProvider] = useState<SandboxProvider>(DEFAULT_SANDBOX_PROVIDER);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const createSandbox = useCreateSandbox();
  const socketConfig = useTerminalSocketConfig(wsBaseUrl, sandboxId);
  const { reportRestError } = useReportUnauthorized();
  const setSandboxStatus = useAppStore((s) => s.setSandboxStatus);
  const clearSandboxStatus = useAppStore((s) => s.clearSandboxStatus);

  const handleCreate = (): void => {
    createSandbox.mutate(
      { projectId: S1_DEFAULT_PROJECT_ID, runtime: S1_DEFAULT_RUNTIME, provider },
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
        providers={SANDBOX_PROVIDERS}
        provider={provider}
        onSelectProvider={setProvider}
        onCreate={handleCreate}
        creating={createSandbox.isPending}
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
      wsBaseUrl={wsBaseUrl}
      socketConfig={socketConfig}
      onRetry={handleRetry}
    />
  );
}
