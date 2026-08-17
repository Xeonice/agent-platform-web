'use client';
// 沙箱生命周期门（10 §7.4 / P20 §3.3）：订阅 /events 驱动 status，
// 据 status 在「启动中进度 → 终端 → 失败重试」间切换。终端只在 running 才开（不再 create 即开、干等重连）。
import { useSandboxEventsSocket } from '@/hooks/useSandboxEventsSocket';
import { useSandboxLifecycle } from '@/hooks/useSandboxLifecycle';
import { useReportUnauthorized } from '@/hooks/useAccessGate';
import { TerminalContainer } from '@/containers/TerminalContainer';
import { SandboxStartupProgressView } from '@/views/sandbox/SandboxStartupProgress.view';
import { Button } from '@/components/ui/button';
import type { TerminalSocketConfig } from '@/types/terminal';

export interface SandboxLifecycleContainerProps {
  sessionId: string;
  sandboxId: string;
  wsBaseUrl: string;
  socketConfig: TerminalSocketConfig;
  /** 失败/结束态的重试入口（回到新建面板）。 */
  onRetry: () => void;
}

export function SandboxLifecycleContainer({
  sessionId,
  sandboxId,
  wsBaseUrl,
  socketConfig,
  onRetry,
}: SandboxLifecycleContainerProps) {
  const { reportUnauthorized } = useReportUnauthorized();
  // 订阅 /events（未授权 → 解锁门）。副作用只在此 hook。
  useSandboxEventsSocket({ base: wsBaseUrl, onUnauthorized: reportUnauthorized });

  const { decision, status, phases, activePhaseIndex, percent } = useSandboxLifecycle(sandboxId);

  if (decision === 'running') {
    return (
      <TerminalContainer sessionId={sessionId} sandboxId={sandboxId} socketConfig={socketConfig} />
    );
  }

  if (decision === 'failed' || decision === 'ended') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <p role="alert" className="text-sm text-red-400">
          {decision === 'failed'
            ? `沙箱启动失败${status !== null ? `（${status}）` : ''}`
            : `沙箱已停止${status !== null ? `（${status}）` : ''}`}
        </p>
        <Button variant="outline" onClick={onRetry}>
          重新创建
        </Button>
      </div>
    );
  }

  // startup / unknown：展示启动中四阶段进度。
  return (
    <SandboxStartupProgressView
      phases={phases}
      activeIndex={activePhaseIndex}
      percent={percent}
      statusLabel={status ?? undefined}
    />
  );
}
