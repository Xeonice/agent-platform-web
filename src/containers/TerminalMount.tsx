'use client';
// 真正实例化 xterm 的子层（08 §2.2）：仅由 TerminalContainer 经 next/dynamic({ssr:false}) 懒加载。
// xterm.css 由 useTerminalInstance（唯一 @xterm/* import 点）随 terminal chunk 注入（08 §2.3）。
import { useCallback, useEffect, useRef } from 'react';
import { useTerminalInstance } from '@/hooks/useTerminalInstance';
import { useSandboxTerminalSocket } from '@/hooks/useSandboxTerminalSocket';
import { TerminalPaneView } from '@/views/terminal/TerminalPane.view';
import { ConnectionStatusView } from '@/views/terminal/ConnectionStatus.view';
import type { TerminalServerFrame } from '@/types/ws-protocol';
import type { TerminalSocketConfig } from '@/types/terminal';

export interface TerminalMountProps {
  sessionId: string;
  sandboxId: string;
  socketConfig: TerminalSocketConfig;
}

export default function TerminalMount({ sessionId, socketConfig }: TerminalMountProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const term = useTerminalInstance();
  const sendRef = useRef<(frame: { type: 'input'; data: string }) => boolean>(() => false);

  const handleFrame = useCallback(
    (frame: TerminalServerFrame): void => {
      // data → 写屏；exit → 展示退出码（08 §8 第三类）；session/pong 由 ptySocket 内部处理。
      if (frame.type === 'data') term.write(sessionId, frame.data);
      else if (frame.type === 'exit')
        term.write(sessionId, `\r\n[进程已退出，code ${String(frame.code)}]\r\n`);
    },
    [term, sessionId],
  );

  const { connState, attempt, send } = useSandboxTerminalSocket({
    uri: socketConfig.uri,
    query: socketConfig.query,
    onFrame: handleFrame,
  });
  sendRef.current = (frame): boolean => send(frame);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    void term.attach({
      sessionId,
      container,
      onInput: (d) => sendRef.current({ type: 'input', data: d }),
      onResize: () => undefined, // resize 帧在 send 具备 open 态后发；冒烟切片不驱动 resize
    });
    return (): void => {
      term.dispose(sessionId);
    };
  }, [term, sessionId]);

  return (
    <div className="flex h-full flex-col">
      <ConnectionStatusView connState={connState} attempt={attempt} />
      <div className="min-h-0 flex-1">
        <TerminalPaneView ref={containerRef} />
      </div>
    </div>
  );
}
