// /events 订阅（副作用归 hook 层，07 §3）：连 /events → 每帧投递到 sandbox 状态 store。
// 复用 ptySocket 的退避重连纪律（reconnection:false + hook 依 reconnectDelay 调度 + 卸载终止）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { EventsSocket, type EventsSocketFactory } from '@/services/ws/eventsSocket';
import { reconnectDelay } from '@/services/ws/ptySocket';
import { reportError } from '@/lib/reportError';
import { buildEventsSocketUri } from '@/lib/sandboxLifecycle';
import { useAppStore } from '@/stores';
import type { ConnState } from '@/types/terminal';

export interface UseSandboxEventsSocketArgs {
  /** WS 基址（origin 或 ws(s)://…，内部归一化为 <origin>/events）。 */
  base: string;
  /** 关闭订阅（如尚无沙箱时）。默认 true。 */
  enabled?: boolean;
  /** WS 未授权 → 弹解锁门（接 useReportUnauthorized().reportUnauthorized）。 */
  onUnauthorized?: () => void;
  /** 测试注入 mock 工厂（避免 mock.module，12 §3.1.1）。 */
  socketFactory?: EventsSocketFactory;
  maxReconnect?: number;
}

export interface UseSandboxEventsSocketApi {
  connState: ConnState;
  attempt: number;
}

export function useSandboxEventsSocket(
  args: UseSandboxEventsSocketArgs,
): UseSandboxEventsSocketApi {
  const { base, enabled = true, onUnauthorized, socketFactory, maxReconnect } = args;

  const [connState, setConnState] = useState<ConnState>('idle');
  const [attempt, setAttempt] = useState(0);
  const socketRef = useRef<EventsSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applySandboxEvent = useAppStore((s) => s.applySandboxEvent);

  // latest-ref：回调/store action 引用抖动不重建连接（08 §7.4 / P0 同理）。
  const applyRef = useRef(applySandboxEvent);
  applyRef.current = applySandboxEvent;
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  const uri = buildEventsSocketUri(base);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setConnState('idle');
      return;
    }
    const socket = new EventsSocket({
      uri,
      socketFactory,
      maxReconnect,
      onEvent: (event) => {
        applyRef.current(event);
      },
      onInvalidFrame: (raw) => {
        reportError('丢弃非法 /events 帧（SandboxEvent zod 校验失败）', { raw });
      },
      onUnauthorized: () => {
        onUnauthorizedRef.current?.();
      },
      onState: (state, nextAttempt) => {
        setConnState(state);
        setAttempt(nextAttempt);
        if (state === 'reconnecting') {
          if (nextAttempt > (maxReconnect ?? 8)) {
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
    // 回调走 latest-ref，不入 deps（P0 同理）。
  }, [uri, enabled, socketFactory, maxReconnect, clearTimer]);

  return { connState, attempt };
}
