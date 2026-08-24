// WS 生命周期、重连、终止条件（08 §3.1/§11.6）。hook 层可用 useEffect（副作用归此层）。
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PtySocket,
  reconnectDelay,
  type ConnState,
  type SocketFactory,
} from '@/services/ws/ptySocket';
import { reportError } from '@/lib/reportError';
import { describeHandshakeErrorCode, isRetryableHandshakeError } from '@/lib/handshakeErrorCopy';
import type { TerminalClientFrame, TerminalServerFrame } from '@/types/ws-protocol';

/** 浅比较两个 string map（P2：把连接稳定性从"调用方君子协定"收回 hook 自身）。 */
function shallowEqualRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}

/** 返回稳定引用：内容浅相等时保持旧引用，避免"新对象但等值"触发连接 effect 重建。 */
function useShallowStableRecord(value: Record<string, string>): Record<string, string> {
  const ref = useRef(value);
  if (!shallowEqualRecord(ref.current, value)) ref.current = value;
  return ref.current;
}

export interface UseSandboxTerminalSocketArgs {
  uri: string;
  /** 基础 query（sandboxId/cols/rows/xSchemaHash）。须是稳定引用（来自 useTerminalSocketConfig 的 useMemo）。 */
  query: Record<string, string>;
  /**
   * 是否允许建连。默认 true。
   *
   * ★ 存在的理由只有一个：**PTY 的初始尺寸必须在建连时就是对的**。
   * query 里的 `cols/rows` 决定容器里 PTY 的出生尺寸，而 agent CLI 一启动就按那个尺寸
   * 画欢迎横幅——终端协议没有"回流"，已经吐出的字节不会因为后来的 resize 重排。
   * 所以调用方要先把 xterm 挂好、fit 出真实尺寸，再放行连接（见 TerminalMount）。
   */
  enabled?: boolean;
  /** Task 主状态；转 stopped/idle/failed 时终止重连循环（08 §8 要点 1）。 */
  sessionEnded?: boolean;
  onFrame: (frame: TerminalServerFrame) => void;
  /** 契约校验失败回调（除内建 reportError 外的额外处理；dev fail-fast / prod 上报不阻断渲染，08 §3.1）。 */
  onInvalidFrame?: (raw: unknown) => void;
  /** WS 握手被口令门拒绝（未授权）时回调，供上层弹解锁门（11 §3.1）。 */
  onUnauthorized?: () => void;
  /** 测试注入 mock socket 工厂（避免 mock.module，12 §3.1.1）。 */
  socketFactory?: SocketFactory;
  maxReconnect?: number;
}

export interface UseSandboxTerminalSocketApi {
  connState: ConnState;
  attempt: number;
  /**
   * 握手被拒的人话（非未授权那一类，如 `SCHEMA_MISMATCH`）；`undefined` = 没有这类问题。
   *
   * 非空时连接条应**代替**「连接超时 + 手动重连」呈现它：协议漂移下那个按钮永远按不通，
   * 把它摆在那里等于让用户反复确认一件已经确定的事。
   */
  handshakeErrorMessage?: string;
  send: (frame: TerminalClientFrame) => boolean;
  /**
   * 用户显式要求再连一次（退避耗尽、`connState==='closed'` 后的唯一出路，08 §11.6 的 `[手动重连]`）。
   *
   * 之所以必须有：退避现在**真的会**撞到上限并停手（见 ptySocket 的 STABLE_CONNECTION_MS），
   * 而终端上的"停手"意味着用户正盯着的 shell 被判死。停手可以，但必须把决定权交回用户，
   * 不能静默停在一条"连接超时"的红条上。
   */
  reconnect: () => void;
}

export function useSandboxTerminalSocket(
  args: UseSandboxTerminalSocketArgs,
): UseSandboxTerminalSocketApi {
  const [connState, setConnState] = useState<ConnState>('idle');
  const [attempt, setAttempt] = useState(0);
  /** 最近一次非未授权的握手拒绝码；null = 没遇到过（连上即清）。 */
  const [handshakeErrorCode, setHandshakeErrorCode] = useState<string | null>(null);
  const socketRef = useRef<PtySocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endedRef = useRef<boolean>(args.sessionEnded ?? false);
  /** 确定性握手失败（重试无意义）——挡住退避循环，与 sessionEnded 同一条"别再连了"的路。 */
  const fatalHandshakeRef = useRef(false);

  endedRef.current = args.sessionEnded ?? false;

  const {
    uri,
    query,
    enabled = true,
    onFrame,
    onInvalidFrame,
    onUnauthorized,
    socketFactory,
    maxReconnect,
  } = args;

  // latest-ref 模式：onFrame/onInvalidFrame/onUnauthorized 每次渲染可能是新引用（父层 useCallback deps 抖动），
  // 存进 ref、不进 effect deps，避免连接 effect 反复 close+重连自我拆除（08 §7.4 / P0）。
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const onInvalidFrameRef = useRef(onInvalidFrame);
  onInvalidFrameRef.current = onInvalidFrame;
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  // P2：query 走浅比较归一化；socketFactory 只做 dev-only 引用稳定性告警（函数无法等值比较）。
  const stableQuery = useShallowStableRecord(query);
  const factoryRef = useRef(socketFactory);
  if (process.env.NODE_ENV !== 'production' && factoryRef.current !== socketFactory) {
    console.warn(
      '[useSandboxTerminalSocket] socketFactory 引用发生变化，将触发重连；请传稳定引用（模块级或 useMemo/useCallback）。',
    );
    factoryRef.current = socketFactory;
  }

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const socket = new PtySocket({
      uri,
      query: stableQuery,
      socketFactory,
      maxReconnect,
      onFrame: (frame) => {
        onFrameRef.current(frame);
      },
      onInvalidFrame: (raw) => {
        // 非法帧不阻断渲染：统一经 reportError 落到单一上报点（dev console / prod 钩子），
        // 再转发给可选的额外处理回调（08 §3.1 / P1-#4）。
        reportError('丢弃非法终端帧（TerminalServerFrame zod 校验失败）', { raw });
        onInvalidFrameRef.current?.(raw);
      },
      onUnauthorized: () => {
        // 未授权是**可自愈**的：解锁拿到 cookie 后下一次重连就过 ⇒ 退避循环照常继续。
        onUnauthorizedRef.current?.();
      },
      onHandshakeError: (code) => {
        setHandshakeErrorCode(code);
        // 确定性失败（今天只有 SCHEMA_MISMATCH）：重连多少次都是同一个结果 ⇒ 当场停手，
        // 由连接条给出真正的出路（刷新页面）。未知码按可重连处理，见 lib/handshakeErrorCopy。
        if (!isRetryableHandshakeError(code)) fatalHandshakeRef.current = true;
        reportError('WS 握手被拒（非未授权）', { code });
      },
      onState: (state, nextAttempt) => {
        setConnState(state);
        setAttempt(nextAttempt);
        // 连上了就说明上一次的握手问题已经不成立（后端回滚/重新部署都可能修好它）。
        if (state === 'open') {
          fatalHandshakeRef.current = false;
          setHandshakeErrorCode(null);
        }
        if (state === 'reconnecting') {
          // 会话已终结 / 确定性握手失败则停止循环（08 §8 要点 1）；否则退避后重连。
          if (endedRef.current || fatalHandshakeRef.current || nextAttempt > (maxReconnect ?? 8)) {
            socket.close();
            return;
          }
          clearTimer();
          timerRef.current = setTimeout(() => {
            socket.connect();
          }, reconnectDelay(nextAttempt));
        }
      },
    });
    socketRef.current = socket;
    socket.connect();

    return (): void => {
      clearTimer();
      socket.close();
      socketRef.current = null;
    };
    // 回调全部走 latest-ref，不入 deps；query 走 stableQuery 浅比较归一化（P0/P2）。
  }, [enabled, uri, stableQuery, socketFactory, maxReconnect, clearTimer]);

  const send = useCallback(
    (frame: TerminalClientFrame): boolean => socketRef.current?.send(frame) ?? false,
    [],
  );

  const reconnect = useCallback((): void => {
    // 会话已终结时重连没有意义（08 §8 要点 1：那条路走的是 [重启]，不是重连）。
    if (endedRef.current) return;
    // 协议漂移同理：手点一次也还是同一个失败。连接条在这种态下压根不渲染重连按钮，
    // 这里兜住键盘等旁路触发——给一个必定失败的动作，比不给更伤。
    if (fatalHandshakeRef.current) return;
    // 可能还压着一个已排期的退避重连：先撤掉，免得手动这次和它撞成两条连接。
    clearTimer();
    // PtySocket#reconnect 会清零退避预算并带回 socketSessionKey（重连窗口没过就接回原 pty）。
    socketRef.current?.reconnect();
  }, [clearTimer]);

  const handshakeErrorMessage =
    handshakeErrorCode === null
      ? undefined
      : (describeHandshakeErrorCode(handshakeErrorCode)?.message ??
        // 后端加了前端还不认识的新码：如实说出码本身，胜过一句"未知错误"。
        `连接被拒绝（${handshakeErrorCode}）。`);

  return {
    connState,
    attempt,
    ...(handshakeErrorMessage === undefined ? {} : { handshakeErrorMessage }),
    send,
    reconnect,
  };
}
