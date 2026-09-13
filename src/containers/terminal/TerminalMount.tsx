'use client';
// 真正实例化 xterm 的子层（08 §2.2）：仅由 TerminalContainer 经 next/dynamic({ssr:false}) 懒加载。
// xterm.css 由 useTerminalInstance（唯一 @xterm/* import 点）随 terminal chunk 注入（08 §2.3）。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTerminalInstance } from '@/hooks/terminal/useTerminalInstance';
import { useSandboxTerminalSocket } from '@/hooks/terminal/useSandboxTerminalSocket';
import { useReportUnauthorized } from '@/hooks/access/useAccessGate';
import { TerminalPaneView } from '@/views/terminal/TerminalPane.view';
import { ConnectionStatusView } from '@/views/terminal/ConnectionStatus.view';
import type {
  TerminalClientFrame,
  TerminalServerFrame,
  TerminalShellSummary,
} from '@/types/ws-protocol';
import type { TerminalSocketConfig } from '@/types/terminal';
import { TERMINAL_EXIT_ATTACH_FAILED } from '@/types/terminal';

export interface TerminalMountProps {
  sessionId: string;
  sandboxId: string;
  socketConfig: TerminalSocketConfig;
  /**
   * 这个标签在不在前台（08 §5.2）。**隐藏由外层用 display 做，实例一律不销毁** ——
   * 这里只需要知道"我刚回到前台"，好补一次 fit。
   *
   * ⚠️ 为什么补这一次 fit 不能省：容器 `display:none` 时宽度是 0，`doFit` 会直接跳过
   * （08 §4.1 纪律 1「隐藏容器不 fit」）。切回来时若不补，xterm 还按隐藏前的行列数
   * 渲染，而 tmux 用绝对定位画状态栏 —— 屏幕上就是一串错位的重复状态栏。
   */
  active?: boolean;
  /** `session` 首帧带回后端分配的 shellId 时回调（用户终端标签才有）。 */
  onShellId?: (shellId: string) => void;
  /**
   * 后端推来的「这个 Task 下还有哪几个用户终端」（06 §5.5/§5.6）。
   * 每条带 `shellId` + 可选的 `runtimeId`（里面跑的是哪个 CLI；缺席 = 纯终端）。
   * `null` = 问不出来。⚠️ 只有 Agent 那条连接会收到这一帧。
   */
  onShells?: (shells: TerminalShellSummary[] | null) => void;
  /**
   * 把这个标签的 `send` 交给装配层（传 `null` = 我卸载了）。
   *
   * ⚠️ 它存在只为一件事：**关掉一个已经被 LRU 淘汰的标签**。那个标签没有连接，
   * 而销毁它的 tmux 会话需要一条通往同一沙箱的 `/terminal` 连接 —— 装配层于是从
   * 还挂着的标签里借一条代发 `close_shell`（帧里带 shellId，见 10 §7.4）。
   */
  registerSend?: (send: ((frame: TerminalClientFrame) => boolean) | null) => void;
}

export default function TerminalMount({
  sessionId,
  socketConfig,
  active = true,
  onShellId,
  onShells,
  registerSend,
}: TerminalMountProps) {
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
      else if (frame.type === 'session') {
        // 用户终端标签：记住后端给这个标签分的 tmux 会话 id。⚠️ 它**不回灌进 query**
        // （那会触发一次连接重建，见下面 fittedSize 处的自喂循环注释）——PtySocket 自己
        // 在重连时会带上它，而装配层记下来是为了这个标签被淘汰后**重建**时能接回去。
        if (frame.shellId !== undefined) onShellIdRef.current?.(frame.shellId);
      } else if (frame.type === 'shells') {
        // ⚠️ `null` 原样往上传，**不许在这里折成 `[]`**：那就是把「问不出来」说成
        //    「没有」，而两者在界面上是两句不同的话（06 §5.5 三态）。
        onShellsRef.current?.(frame.shells);
      } else if (frame.type === 'exit') {
        // ⚠️ 两个码语义不同,不能合并成一句话：
        //  · `-2`（TERMINAL_EXIT_ATTACH_FAILED）= 平台**没能附着上**，运行环境多半已不在
        //    ⇒ 重连不会有结果，出路是重新发起任务；
        //  · `-1` = 进程真的退出了但退出码未知（被信号杀死，例如 OOM）⇒ 任务跑过、
        //    可能有日志，说"运行环境不在了"是假话。
        // 第一版把两者都当 `-1` 处理，于是一个被 OOM kill 的 agent 会被告知
        // "实例可能已不存在"——后端已改用独立哨兵码，前端跟上。
        const attachFailed = frame.code === TERMINAL_EXIT_ATTACH_FAILED;
        /**
         * ⛔ **`-2` 时不往终端里写「[进程已退出，code -2]」。**
         *
         * `-2` 是**平台自造的哨兵码**，不是任何进程的退出码 —— 这一支上根本没有进程退出
         * 这回事（平台压根没附着上）。把它印成"进程已退出，code -2"是在终端里写一句假话，
         * 而且是用户最可能截图去搜的那一句。上面那个区分本来只落到了状态条，屏幕上
         * 这一行仍然把两支混成一样。
         *
         * ⇒ `-2` 只走状态条（`sessionEndedMessage`，说清"没能连上、重连没用"）。
         *   `-1` 与真实退出码照旧写屏：那两支确实有一个进程退出过。
         */
        if (!attachFailed) {
          term.write(sessionId, `\r\n[进程已退出，code ${String(frame.code)}]\r\n`);
        }
        setEndedMessage(
          attachFailed
            ? '终端会话已结束——没能连上这个任务的运行环境（多半已经回收了）。重连不会有结果，请重新发起一个任务。'
            : frame.code === -1
              ? '终端会话已结束（进程被信号终止，退出码未知）。'
              : `终端会话已结束（退出码 ${String(frame.code)}）。`,
        );
      }
    },
    [term, sessionId],
  );

  // latest-ref：回调来自父层的 useCallback，身份可能每帧变。进 deps 会让 handleFrame
  // 重建 → 连接 effect 抖动（本文件已经为同一个原因栽过一次，见 fittedSize 注释）。
  const onShellIdRef = useRef(onShellId);
  onShellIdRef.current = onShellId;
  const onShellsRef = useRef(onShells);
  onShellsRef.current = onShells;

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

  // 把 send 交给装配层，供它在别的标签被淘汰时代发 `close_shell`。
  // ⚠️ 交出去的是一个**稳定的转发器**（读 sendRef），不是 `send` 本身 —— 后者每次
  //    重连都是新引用，直接交出去会让这个 effect 反复注册/注销。
  useEffect(() => {
    if (registerSend === undefined) return;
    registerSend((frame) => sendRef.current(frame));
    return (): void => {
      registerSend(null);
    };
  }, [registerSend]);

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

  /**
   * 回到前台就补一次 fit（08 §5.2「切回补一次 fit」）。
   *
   * 隐藏期间容器宽度是 0，`doFit` 按纪律直接跳过；不补的话 xterm 会停在隐藏前的
   * 行列数，而 PTY 那边可能已经被别的路径改过 —— 两边尺寸不一致时，tmux 用绝对定位
   * 画的状态栏会在屏幕上叠出一串错位的重复行。
   */
  useEffect(() => {
    if (active) term.fit(sessionId);
  }, [active, term, sessionId]);

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
