// WS 生命周期、重连、终止条件（08 §3.1/§11.6）。hook 层可用 useEffect（副作用归此层）。
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PtySocket,
  reconnectDelay,
  type ConnState,
  type SocketFactory,
} from '@/services/ws/ptySocket';
import { reportError } from '@/lib/reportError';
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
  send: (frame: TerminalClientFrame) => boolean;
}

export function useSandboxTerminalSocket(
  args: UseSandboxTerminalSocketArgs,
): UseSandboxTerminalSocketApi {
  const [connState, setConnState] = useState<ConnState>('idle');
  const [attempt, setAttempt] = useState(0);
  const socketRef = useRef<PtySocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endedRef = useRef<boolean>(args.sessionEnded ?? false);

  endedRef.current = args.sessionEnded ?? false;

  const { uri, query, onFrame, onInvalidFrame, onUnauthorized, socketFactory, maxReconnect } = args;

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
        onUnauthorizedRef.current?.();
      },
      onState: (state, nextAttempt) => {
        setConnState(state);
        setAttempt(nextAttempt);
        if (state === 'reconnecting') {
          // 会话已终结则停止循环（08 §8 要点 1）；否则退避后重连。
          if (endedRef.current || nextAttempt > (maxReconnect ?? 8)) {
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
  }, [uri, stableQuery, socketFactory, maxReconnect, clearTimer]);

  const send = useCallback(
    (frame: TerminalClientFrame): boolean => socketRef.current?.send(frame) ?? false,
    [],
  );

  return { connState, attempt, send };
}
