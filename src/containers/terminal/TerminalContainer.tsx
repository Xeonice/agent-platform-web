'use client';
// 'use client' + next/dynamic 装配（08 §2.2）：把 xterm 实例化限制在 ssr:false 的独立 chunk，首屏不加载终端代码。
import dynamic from 'next/dynamic';
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
}

export function TerminalContainer({ sessionId, sandboxId, socketConfig }: TerminalContainerProps) {
  return <TerminalMount sessionId={sessionId} sandboxId={sandboxId} socketConfig={socketConfig} />;
}
