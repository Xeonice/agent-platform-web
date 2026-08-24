'use client';
// 真正实例化 xterm 的子层（08 §2.2）：仅由 TerminalContainer 经 next/dynamic({ssr:false}) 懒加载。
// xterm.css 由 useTerminalInstance（唯一 @xterm/* import 点）随 terminal chunk 注入（08 §2.3）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTerminalInstance } from '@/hooks/terminal/useTerminalInstance';
import { useSandboxTerminalSocket } from '@/hooks/terminal/useSandboxTerminalSocket';
import { useReportUnauthorized } from '@/hooks/access/useAccessGate';
import { TerminalPaneView } from '@/views/terminal/TerminalPane.view';
import { ConnectionStatusView } from '@/views/terminal/ConnectionStatus.view';
import type { TerminalClientFrame, TerminalServerFrame } from '@/types/ws-protocol';
import type { TerminalSocketConfig } from '@/types/terminal';
import { TERMINAL_EXIT_ATTACH_FAILED } from '@/types/terminal';

export interface TerminalMountProps {
  sessionId: string;
  sandboxId: string;
  socketConfig: TerminalSocketConfig;
}

export default function TerminalMount({ sessionId, socketConfig }: TerminalMountProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const term = useTerminalInstance();
  const sendRef = useRef<(frame: TerminalClientFrame) => boolean>(() => false);

  /**
   * 会话已结束（收到 `exit`）。**必须接线**：`useSandboxTerminalSocket` 的 `endedRef`
   * 读的就是这一位,而此前这里从来没传过 ⇒ 它恒为 false ⇒ 即使 shell 正常退出、
   * 或后端根本附着不上,前端也照样一轮轮退避重连。
   */
  const [endedMessage, setEndedMessage] = useState<string | null>(null);

  /**
   * xterm fit 出来的真实尺寸；**在拿到它之前不建连**。
   *
   * ★ 这是本次改造的核心。socketConfig.query 的 `cols/rows` 决定容器里 **PTY 的出生
   * 尺寸**，而 agent CLI 一启动就按它画欢迎横幅/边框。终端协议里没有"回流"——已经
   * 吐出的字节不会因为后来的 resize 重排，所以此前"先按 80x24 连上、再补一帧 resize"
   * 的做法**救不回第一屏**：宽屏上就是一个 80 列的窄框浮在一大片空白里。
   *
   * 代价是连接晚一帧（attach → fit → setState → 连）。换来的是 PTY 一出生尺寸就对。
   */
  const [fittedSize, setFittedSize] = useState<{ cols: number; rows: number } | null>(null);

  const handleFrame = useCallback(
    (frame: TerminalServerFrame): void => {
      // data → 写屏；exit → 展示退出码（08 §8 第三类）；session/pong 由 ptySocket 内部处理。
      if (frame.type === 'data') term.write(sessionId, frame.data);
      else if (frame.type === 'exit') {
        term.write(sessionId, `\r\n[进程已退出，code ${String(frame.code)}]\r\n`);
        // ⚠️ 两个码语义不同,不能合并成一句话：
        //  · `-2`（TERMINAL_EXIT_ATTACH_FAILED）= 平台**没能附着上**，实例多半已不在
        //    ⇒ 重连不会有结果，出路是重新发起任务；
        //  · `-1` = 进程真的退出了但退出码未知（被信号杀死，例如 OOM）⇒ 任务跑过、
        //    可能有日志，说"实例不在了"是假话。
        // 第一版把两者都当 `-1` 处理，于是一个被 OOM kill 的 agent 会被告知
        // "实例可能已不存在"——后端已改用独立哨兵码，前端跟上。
        setEndedMessage(
          frame.code === TERMINAL_EXIT_ATTACH_FAILED
            ? '终端会话已结束——没能连上这个任务的实例（多半已不存在）。重连不会有结果，请重新发起任务。'
            : frame.code === -1
              ? '终端会话已结束（进程被信号终止，退出码未知）。'
              : `终端会话已结束（退出码 ${String(frame.code)}）。`,
        );
      }
    },
    [term, sessionId],
  );

  const { reportUnauthorized } = useReportUnauthorized();

  // 非法帧的上报由 useSandboxTerminalSocket 内建经 lib/reportError 落到单一消费点（P1-#4）；
  // 容器层禁止直接 import lib（boundaries），故这里只接 WS 未授权 → 弹解锁门。
  // 真实尺寸就位后才把它并进 query；之前保持 null ⇒ 不建连。
  const query = useMemo(
    () =>
      fittedSize === null
        ? socketConfig.query
        : { ...socketConfig.query, cols: String(fittedSize.cols), rows: String(fittedSize.rows) },
    [socketConfig.query, fittedSize],
  );

  const { connState, attempt, send, reconnect, handshakeErrorMessage } = useSandboxTerminalSocket({
    uri: socketConfig.uri,
    query,
    enabled: fittedSize !== null,
    onFrame: handleFrame,
    onUnauthorized: reportUnauthorized,
    sessionEnded: endedMessage !== null,
  });
  sendRef.current = (frame): boolean => send(frame);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    void term.attach({
      sessionId,
      container,
      onInput: (d) => sendRef.current({ type: 'input', data: d }),
      onResize: (cols, rows) => {
        // 首次 fit：记下尺寸放行连接（此时还没有 socket，send 必然返回 false，正常）。
        // 之后的每一次（窗口缩放/侧栏折叠）走 resize 帧，正是它本该干的事。
        // ★ **只认第一次**。这个值进的是建连 query，而 query 在
        // `useSandboxTerminalSocket` 的连接 effect 依赖里 —— 每变一次就 close + 重连。
        // 而连接态一变，`ConnectionStatus` 会渲染一条约 28px 的横条，终端可用高度随之
        // 变化 ⇒ 行数变 ⇒ query 又变 ⇒ **再重连**：一个自喂循环（实测一次拖拽 2–3 轮）。
        // 代价不止性能：新建的 PtySocket 丢掉 socketSessionKey（接不回原 pty）、
        // 把退避预算清零，后端抖动时"退避耗尽 → 手动重连"那个终点态可能永远到不了。
        //
        // L-7 真正需要的只是**出生尺寸对**；之后的变化本来就该走 resize 帧（下一行）。
        setFittedSize((prev) => prev ?? { cols, rows });
        sendRef.current({ type: 'resize', cols, rows });
      },
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
   * ⚠️ 仍然不能省，但**理由已经变了**。此前它是唯一的尺寸来源：连接 query 写死
   * 80x24，真实尺寸只能靠这一帧补——而那救不回 agent CLI 已经按 80 列画完的第一屏。
   * 现在建连时 query 里带的就是 fit 出来的真实尺寸（见 `fittedSize`），它退回成一条
   * **兜底**：attach 那次上报发生在 socket open 之前（`send` 未 open 即丢弃），而尺寸
   * 此后没再变过，去重逻辑就判定"和上次一样"不再重发；重连场景同理。留着它，PTY 与
   * xterm 的尺寸在任何路径下都不会各说各话（tmux 用绝对定位画状态栏，尺寸不一致时
   * 屏幕上就是一串错位的重复状态栏）。
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
        {...(endedMessage === null ? {} : { sessionEndedMessage: endedMessage })}
      />
      <div className="min-h-0 flex-1">
        <TerminalPaneView ref={containerRef} />
      </div>
    </div>
  );
}
