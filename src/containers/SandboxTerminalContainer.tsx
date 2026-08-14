'use client';
// S1 主容器：建沙箱 → 拿 id → 连 /terminal WS → 交给 TerminalContainer 挂 xterm。
// 唯一 view↔hooks 粘合点；副作用只在 hook（useCreateSandbox / useTerminalWsUrl），本层只做编排与本地 UI 态。
import { useState } from 'react';
import { useCreateSandbox } from '@/hooks/useCreateSandbox';
import { useTerminalSocketConfig } from '@/hooks/useTerminalSocketConfig';
import { NewSandboxPanelView } from '@/views/sandbox/NewSandboxPanel.view';
import { TerminalContainer } from '@/containers/TerminalContainer';
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

  const handleCreate = (): void => {
    createSandbox.mutate(
      { projectId: S1_DEFAULT_PROJECT_ID, runtime: S1_DEFAULT_RUNTIME, provider },
      {
        onSuccess: (sandbox) => {
          setSandboxId(sandbox.id);
        },
      },
    );
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
  return (
    <TerminalContainer
      sessionId={`${sandboxId}:0`}
      sandboxId={sandboxId}
      socketConfig={socketConfig}
    />
  );
}
