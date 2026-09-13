'use client';
// 'use client' + next/dynamic 装配（08 §2.2）：把 xterm 实例化限制在 ssr:false 的独立 chunk，首屏不加载终端代码。
import dynamic from 'next/dynamic';
import type { TerminalClientFrame, TerminalShellSummary } from '@/types/ws-protocol';
import type { TerminalSocketConfig } from '@/types/terminal';

const TerminalMount = dynamic(() => import('@/containers/terminal/TerminalMount'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      终端加载中…
    </div>
  ),
});

export interface TerminalContainerProps {
  sessionId: string;
  sandboxId: string;
  socketConfig: TerminalSocketConfig;
  /** 在不在前台（隐藏由外层做，实例不销毁，08 §5.2）。 */
  active?: boolean;
  /** `session` 首帧带回的后端 tmux 会话 id（用户终端标签才有）。 */
  onShellId?: (shellId: string) => void;
  /** 后端推来的用户终端清单（06 §5.5/§5.6）；只有 Agent 那条连接会收到。 */
  onShells?: (shells: TerminalShellSummary[] | null) => void;
  /** 把 send 交给装配层，供它代发 `close_shell`（见 TerminalMount 的注释）。 */
  registerSend?: (send: ((frame: TerminalClientFrame) => boolean) | null) => void;
  /** 终端仪表壳工具栏的面包屑（design-notes.md §4 Phase 3），原样透传给 `TerminalMount`。 */
  breadcrumb?: string;
}

export function TerminalContainer({
  sessionId,
  sandboxId,
  socketConfig,
  active,
  onShellId,
  onShells,
  registerSend,
  breadcrumb,
}: TerminalContainerProps) {
  return (
    <TerminalMount
      sessionId={sessionId}
      sandboxId={sandboxId}
      socketConfig={socketConfig}
      {...(active === undefined ? {} : { active })}
      {...(onShellId === undefined ? {} : { onShellId })}
      {...(onShells === undefined ? {} : { onShells })}
      {...(registerSend === undefined ? {} : { registerSend })}
      {...(breadcrumb === undefined ? {} : { breadcrumb })}
    />
  );
}
