// /events 订阅（副作用归 hook 层，07 §3）：连 /events → 每帧投递到 sandbox 状态 store。
// 复用 ptySocket 的退避重连纪律（reconnection:false + hook 依 reconnectDelay 调度 + 卸载终止），
// 并且与 ptySocket / taskSocket 共享同一条 STABLE_CONNECTION_MS 纪律：连上即掉不清零退避
// ⇒ 抖动时退避真的会增长到 30s 封顶，而不是每秒重建一条 socket。
//
// ⚠️ 但**重试次数上限这条，/events 刻意与另外两个通道不同：它不停手**（S6 收尾 ②）。
// 三条理由，都不是"图省事"：
//  ① **停手在这里是最坏的选项**。/events 是全站唯一的实时投影源：沙箱状态、克隆进度、
//     runtime 凭证变更全走它。它一停，沙箱就永远停在「启动中…」、克隆进度条永远不动，
//     而用户看不到任何解释 —— 那正是"静默停在那里"的最严重版本。
//  ② **停手在这里也没有换来任何东西**。终端"停手"是一个**破坏性决定**：`socketSessionKey`
//     的重连窗口会在停手期间过期，pty 现场就永久没了，所以必须把决定权交回用户（08 §11.6）。
//     /events **没有任何会过期的东西**：无会话凭据、无窗口，任何时刻重连都完整恢复投影。
//     既然停手不保护什么，它就只剩下代价。
//  ③ **它没有可以承载按钮的界面**。这条通道 headless 挂在 WorkbenchContainer 上，
//     connState 一个字都不渲染。给它做「重新连接」＝凭空造一个全局横幅，为一个用户
//     根本感知不到的通道新增一个 UI 概念 —— 那比它要修的问题更大。
// 于是正确形状是「永不停手 + 退避封顶 30s」：后端回来的那一刻整个工作台自愈，零用户动作。
// 代价是后端长时间不可用时每 30s 一次握手 —— 这也正是 socket.io 自带重连的默认口径
// （`reconnectionAttempts: Infinity` + 封顶延迟）；我们关掉它只是为了自己掌握 query 与订阅重发，
// 从来不是为了改重试次数策略。`useAccessGate` 那句"WS 自身在退避循环中，cookie 就位后下次
// 重连即通过"也正是靠这条才对全局 /events 成立。
import { useCallback, useEffect, useRef, useState } from 'react';
import { EventsSocket, type EventsSocketFactory } from '@/services/ws/eventsSocket';
import { reconnectDelay } from '@/services/ws/ptySocket';
import { reportError } from '@/lib/_shared/reportError';
import { buildEventsSocketUri } from '@/lib/sandbox/sandboxLifecycle';
import { useAppStore } from '@/stores';
import type { SandboxEvent } from '@/types/ws-protocol';
import type { ConnState } from '@/types/terminal';

export interface UseSandboxEventsSocketArgs {
  /** WS 基址（origin 或 ws(s)://…，内部归一化为 <origin>/events）。 */
  base: string;
  /** 关闭订阅（如尚无沙箱时）。默认 true。 */
  enabled?: boolean;
  /** WS 未授权 → 弹解锁门（接 useReportUnauthorized().reportUnauthorized）。 */
  onUnauthorized?: () => void;
  /** runtime-auth.status_changed → patch runtime 凭证 Query（15 §2.3，接 useRuntimeAuthSync）。 */
  onRuntimeAuthChanged?: (runtime: string) => void;
  /**
   * 任何 `sandbox.*` 事件到达（接工作台失效左侧任务树 + 项目列表）。
   *
   * ⚠️ 为什么不在 hook 内部直接 invalidate：这个 hook 已经把事件分发给两个 store slice，
   * 那是**纯内存投影**；Query 失效是取数策略，属于调用方（15 §2.3 前端纪律：
   * WS 只 patch/失效，不在通道层决定谁该重新取数）。
   */
  onSandboxChanged?: (event: SandboxEvent) => void;
  /** 测试注入 mock 工厂（避免 mock.module，12 §3.1.1）。 */
  socketFactory?: EventsSocketFactory;
  // ⚠️ **刻意没有** maxReconnect：本通道不设重试次数上限（理由见文件头注释）。
}

export interface UseSandboxEventsSocketApi {
  connState: ConnState;
  attempt: number;
  /**
   * 最近一次**非未授权**的握手拒绝码（如 `SCHEMA_MISMATCH`）；`undefined` = 没遇到过。
   *
   * ⚠️ 这条通道**刻意不给 UI**（文件头 ③：它没有可以承载按钮的界面），也**刻意不停手**
   * （文件头 ①②）。但"不给 UI"不等于"不说话"：以前这类拒绝在 /events 上是彻底静默的，
   * 表现为整个工作台永远停在启动中而没有任何解释。现在至少经 `reportError` 落到单一上报点，
   * 并把码透出来供上层需要时消费——不占用界面，也不再假装什么都没发生。
   */
  handshakeErrorCode?: string;
}

export function useSandboxEventsSocket(
  args: UseSandboxEventsSocketArgs,
): UseSandboxEventsSocketApi {
  const {
    base,
    enabled = true,
    onUnauthorized,
    onRuntimeAuthChanged,
    onSandboxChanged,
    socketFactory,
  } = args;

  const [connState, setConnState] = useState<ConnState>('idle');
  const [attempt, setAttempt] = useState(0);
  const [handshakeErrorCode, setHandshakeErrorCode] = useState<string | null>(null);
  const socketRef = useRef<EventsSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applySandboxEvent = useAppStore((s) => s.applySandboxEvent);
  const applyProjectCloneEvent = useAppStore((s) => s.applyProjectCloneEvent);

  // latest-ref：回调/store action 引用抖动不重建连接（08 §7.4 / P0 同理）。
  const applyRef = useRef(applySandboxEvent);
  applyRef.current = applySandboxEvent;
  const applyCloneRef = useRef(applyProjectCloneEvent);
  applyCloneRef.current = applyProjectCloneEvent;
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const onRuntimeAuthChangedRef = useRef(onRuntimeAuthChanged);
  onRuntimeAuthChangedRef.current = onRuntimeAuthChanged;
  const onSandboxChangedRef = useRef(onSandboxChanged);
  onSandboxChangedRef.current = onSandboxChanged;

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
      onEvent: (event) => {
        // 单一 /events 通道分发到相关 slice：sandbox.* → 状态表，project.clone_progress → 克隆表。
        // 各 action 对不相关变体自身 no-op（switch/default），彼此不干扰。
        applyRef.current(event);
        applyCloneRef.current(event);
        if (event.event === 'runtime-auth.status_changed') {
          onRuntimeAuthChangedRef.current?.(event.runtime);
        }
        if (event.event.startsWith('sandbox.')) {
          onSandboxChangedRef.current?.(event);
        }
      },
      onInvalidFrame: (raw) => {
        reportError('丢弃非法 /events 帧（SandboxEvent zod 校验失败）', { raw });
      },
      onUnauthorized: () => {
        onUnauthorizedRef.current?.();
      },
      onHandshakeError: (code) => {
        // 不改重连策略（本通道永不停手，理由见文件头）；只保证这件事**被说出来**。
        setHandshakeErrorCode(code);
        reportError('/events 握手被拒（非未授权）', { code });
      },
      onState: (state, nextAttempt) => {
        setConnState(state);
        setAttempt(nextAttempt);
        // 连上了 = 上一次的握手问题已不成立（后端回滚/重新部署都可能修好它）。
        if (state === 'open') setHandshakeErrorCode(null);
        if (state === 'reconnecting') {
          // **没有次数上限**（文件头 ①②③）：只退避、不停手。delay 由 reconnectDelay 封顶在 30s，
          // 所以"无限重试"的实际形态是每 30s 敲一次门，而不是一个忙循环。
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
  }, [uri, enabled, socketFactory, clearTimer]);

  return {
    connState,
    attempt,
    ...(handshakeErrorCode === null ? {} : { handshakeErrorCode }),
  };
}
