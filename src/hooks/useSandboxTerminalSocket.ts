// WS 生命周期、重连、终止条件（08 §3.1/§11.6）。hook 层可用 useEffect（副作用归此层）。
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PtySocket,
  reconnectDelay,
  type ConnState,
  type SocketFactory,
} from '@/services/ws/ptySocket';
import type { TerminalClientFrame, TerminalServerFrame } from '@/types/ws-protocol';

export interface UseSandboxTerminalSocketArgs {
  uri: string;
  /** 基础 query（sandboxId/cols/rows/xSchemaHash）。须是稳定引用（来自 useTerminalSocketConfig 的 useMemo）。 */
  query: Record<string, string>;
  /** Task 主状态；转 stopped/idle/failed 时终止重连循环（08 §8 要点 1）。 */
  sessionEnded?: boolean;
  onFrame: (frame: TerminalServerFrame) => void;
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

  const { uri, query, onFrame, socketFactory, maxReconnect } = args;

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const socket = new PtySocket({
      uri,
      query,
      socketFactory,
      maxReconnect,
      onFrame,
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
  }, [uri, query, onFrame, socketFactory, maxReconnect, clearTimer]);

  const send = useCallback(
    (frame: TerminalClientFrame): boolean => socketRef.current?.send(frame) ?? false,
    [],
  );

  return { connState, attempt, send };
}
