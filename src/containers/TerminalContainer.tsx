'use client';
// 'use client' + next/dynamic 装配（08 §2.2）：把 xterm 实例化限制在 ssr:false 的独立 chunk，
// 首屏不加载终端代码；无选中 Task 时渲染空态引导（08 §2.2）。
import dynamic from 'next/dynamic';
import { TerminalPaneView } from '@/views/terminal/TerminalPane.view';

const TerminalMount = dynamic(() => import('@/containers/TerminalMount'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      终端加载中…
    </div>
  ),
});

export interface TerminalContainerProps {
  sessionId: string | null;
  sandboxId: string | null;
  wsUrl: string;
}

export function TerminalContainer({ sessionId, sandboxId, wsUrl }: TerminalContainerProps) {
  if (sessionId === null || sandboxId === null) {
    return <TerminalPaneView empty />;
  }
  return <TerminalMount sessionId={sessionId} sandboxId={sandboxId} wsUrl={wsUrl} />;
}
