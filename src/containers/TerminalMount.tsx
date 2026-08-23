'use client';
// 真正实例化 xterm 的子层（08 §2.2）：仅由 TerminalContainer 经 next/dynamic({ssr:false}) 懒加载。
// xterm.css 由 useTerminalInstance（唯一 @xterm/* import 点）随 terminal chunk 注入（08 §2.3）。
import { useCallback, useEffect, useRef } from 'react';
import { useTerminalInstance } from '@/hooks/useTerminalInstance';
import { useSandboxTerminalSocket } from '@/hooks/useSandboxTerminalSocket';
import { useReportUnauthorized } from '@/hooks/useAccessGate';
import { TerminalPaneView } from '@/views/terminal/TerminalPane.view';
import { ConnectionStatusView } from '@/views/terminal/ConnectionStatus.view';
import type { TerminalClientFrame, TerminalServerFrame } from '@/types/ws-protocol';
import type { TerminalSocketConfig } from '@/types/terminal';

export interface TerminalMountProps {
  sessionId: string;
  sandboxId: string;
  socketConfig: TerminalSocketConfig;
}

export default function TerminalMount({ sessionId, socketConfig }: TerminalMountProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const term = useTerminalInstance();
  const sendRef = useRef<(frame: TerminalClientFrame) => boolean>(() => false);

  const handleFrame = useCallback(
    (frame: TerminalServerFrame): void => {
      // data → 写屏；exit → 展示退出码（08 §8 第三类）；session/pong 由 ptySocket 内部处理。
      if (frame.type === 'data') term.write(sessionId, frame.data);
      else if (frame.type === 'exit')
        term.write(sessionId, `\r\n[进程已退出，code ${String(frame.code)}]\r\n`);
    },
    [term, sessionId],
  );

  const { reportUnauthorized } = useReportUnauthorized();

  // 非法帧的上报由 useSandboxTerminalSocket 内建经 lib/reportError 落到单一消费点（P1-#4）；
  // 容器层禁止直接 import lib（boundaries），故这里只接 WS 未授权 → 弹解锁门。
  const { connState, attempt, send, reconnect, handshakeErrorMessage } = useSandboxTerminalSocket({
    uri: socketConfig.uri,
    query: socketConfig.query,
    onFrame: handleFrame,
    onUnauthorized: reportUnauthorized,
  });
  sendRef.current = (frame): boolean => send(frame);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    void term.attach({
      sessionId,
      container,
      onInput: (d) => sendRef.current({ type: 'input', data: d }),
      onResize: (cols, rows) => sendRef.current({ type: 'resize', cols, rows }),
    });

    // 容器尺寸变化 → 重新 fit → 上报。窗口缩放、侧栏折叠、无头面板展开都会走这里。
    const ro = new ResizeObserver(() => {
      term.fit(sessionId);
    });
    ro.observe(container);

    return (): void => {
      ro.disconnect();
      term.dispose(sessionId);
    };
  }, [term, sessionId]);

  /**
   * socket 一 open 就把真实尺寸补报一次。
   *
   * ⚠️ 这一步不能省:连接 query 里的 `cols/rows` 是**写死的 80x24**(见
   * `lib/terminalSocket`),真实尺寸本来就该靠 resize 帧补。但 attach 那次上报往往
   * 发生在 socket open 之前 —— `send` 未 open 即丢弃 —— 而尺寸此后没再变过,
   * 去重逻辑就判定"和上次一样"不再重发。于是 PTY 永远停在 80x24,而 xterm 按真实
   * 尺寸渲染:tmux 用绝对定位画状态栏,行号全错,屏幕上就是一串重复的状态栏。
   */
  useEffect(() => {
    if (connState === 'open') term.resync(sessionId);
  }, [connState, term, sessionId]);

  return (
    <div className="flex h-full flex-col">
      {/*
        退避耗尽后必须给一条出路：ptySocket 现在真的会撞到上限并停手（STABLE_CONNECTION_MS），
        而终端上的"停手"＝用户正盯着的 shell 被判死。接线在这里，那个「手动重连」才不是死按钮。
      */}
      {/* handshakeErrorMessage 非空 = 协议漂移这类**确定性**拒绝：状态条改说"请刷新页面"，
          并且不再给那个按不通的「手动重连」（hook 那边也已停掉退避循环）。 */}
      <ConnectionStatusView
        connState={connState}
        attempt={attempt}
        onManualReconnect={reconnect}
        handshakeErrorMessage={handshakeErrorMessage}
      />
      <div className="min-h-0 flex-1">
        <TerminalPaneView ref={containerRef} />
      </div>
    </div>
  );
}
