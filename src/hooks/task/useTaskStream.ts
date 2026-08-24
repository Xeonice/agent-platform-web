// /tasks 订阅（副作用归 hook 层，07 §3）：连 /tasks → subscribe(taskId, fromSeq) → 帧喂进纯 reducer。
//
// 三条纪律：
//  ① **零轮询**。唯一的"补"是 subscribe 带 `fromSeq` 让后端回放，那是后端的事；
//     本 hook 不设任何定时拉取。
//  ② **每次 open 都重发 subscribe**，且 fromSeq 取"当前已收到的最大 seq" ⇒
//     断线重连与刷新恢复走的是同一条代码路径（刷新时内存为空 ⇒ lastSeq=0 ⇒ 请后端从头回放）。
//  ③ seq 缺口不容忍：reducer 检出后经 reportError 上报一次，UI 另有显著提示。
//  ④ **终态是这条流的终点**：收到 `exit` 后不再重连、`onExit` 也只回调一次。
//     后端契约写明"终态任务重新 subscribe 必定补发 exit"，所以每一次重连都会再触发一次
//     `onExit → refetch`——不封住的话，网络一抖它就变成一个由重连驱动的 REST 轮询器，
//     与本文件第一条纪律直接冲突。
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { TaskSocket, type TaskSocketFactory } from '@/services/ws/taskSocket';
import { reconnectDelay } from '@/services/ws/ptySocket';
import { reportError } from '@/lib/_shared/reportError';
import { buildTasksSocketQuery, buildTasksSocketUri } from '@/lib/task/taskSocketConfig';
import {
  buildSubscribeFrame,
  describeSeqAnomaly,
  initialTaskStreamState,
  selectSeqAnomaly,
  taskStreamReducer,
} from '@/lib/task/taskStream';
import type { TaskExit, TaskStreamState } from '@/types/taskStream';
import type { ConnState } from '@/types/terminal';

export interface UseTaskStreamArgs {
  /** WS 基址（origin 或 ws(s)://…，内部归一化为 <origin>/tasks）。 */
  base: string;
  /**
   * 这条连接在看哪个沙箱 —— 进**握手 query**（不是 subscribe 帧），后端据此做订阅归属校验。
   * 必填：不带等于让后端放行任意 taskId（见 lib/taskSocketConfig 的注释）。
   */
  sandboxId: string;
  /** null = 当前没有任务在跑，不建连接。 */
  taskId: string | null;
  /** WS 未授权 → 弹解锁门（接 useReportUnauthorized().reportUnauthorized）。 */
  onUnauthorized?: () => void;
  /** 收到 exit 帧时回调（容器据此去拉一次 DTO 取产物列表——事件驱动，不是轮询）。 */
  onExit?: (exit: TaskExit) => void;
  /** 测试注入 mock 工厂（避免 mock.module，12 §3.1.1）；须是稳定引用。 */
  socketFactory?: TaskSocketFactory;
  maxReconnect?: number;
}

export interface UseTaskStreamApi {
  connState: ConnState;
  attempt: number;
  stream: TaskStreamState;
  /** seq 异常的人话（view 不能 import lib，故在此层派生）；undefined = 一切正常。 */
  seqAnomalyMessage?: string;
  /**
   * 用户显式要求再连一次（退避耗尽、`connState==='closed'` 之后的唯一出路）。
   *
   * ⚠️ **不是"重来一遍"**：已经渲染出来的 `items` 与 `lastSeq` 记账原样保留，重连成功后
   * 走的仍是那条唯一路径 `subscribe(taskId, fromSeq)` ⇒ 后端只补断开期间缺的那一截。
   * 把面板清空重订才是最坏的做法——用户面前正是一屏看了很久的输出。
   *
   * 终态已到时是 no-op：那条流不会再有新东西，重连只换来一次完整回放 + 一帧补发的 exit。
   */
  reconnect: () => void;
}

export function useTaskStream(args: UseTaskStreamArgs): UseTaskStreamApi {
  const { base, sandboxId, taskId, onUnauthorized, onExit, socketFactory, maxReconnect } = args;

  const [connState, setConnState] = useState<ConnState>('idle');
  const [attempt, setAttempt] = useState(0);
  const [stream, dispatch] = useReducer(taskStreamReducer, undefined, initialTaskStreamState);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 本条流是否已经收到终态。
   *
   * 用 ref 而不是 effect 内的局部量，是因为「重新连接」回调住在 effect **之外**也要读它；
   * **复位仍然钉在 taskId 上**（在 effect 体内赋 false ⇒ 换 taskId 自动归零），
   * 不依赖任何额外的复位时序。
   */
  const exitSeenRef = useRef(false);
  /** 当前这条连接（供「重新连接」在 effect 之外驱动）。 */
  const socketRef = useRef<TaskSocket | null>(null);

  // 重连时要带回的 fromSeq。用 ref 是因为 subscribe 发生在 socket 回调里（不在渲染流程内），
  // 那一刻需要"此刻最新的 lastSeq"，而不是 effect 闭包捕获的旧值。
  const lastSeqRef = useRef(0);
  useEffect(() => {
    lastSeqRef.current = stream.lastSeq;
  }, [stream.lastSeq]);

  // 粘性异常 + 读时现算的 behind-caught-up 合成"此刻该报什么"。
  const seqAnomaly = selectSeqAnomaly(stream);

  // seq 异常只上报一次（粘性异常一旦置上就不再变化；behind 会自愈，自愈前只报这一次）。
  const reportedAnomalyRef = useRef(false);
  useEffect(() => {
    if (seqAnomaly === null || reportedAnomalyRef.current) return;
    reportedAnomalyRef.current = true;
    reportError('无头 Task 事件流 seq 异常（缺口/落后于 caught_up）——后端投递问题，不做本地补拉', {
      taskId,
      anomaly: seqAnomaly,
    });
  }, [seqAnomaly, taskId]);

  // latest-ref：回调引用抖动不重建连接（08 §7.4 / P0 同理）。
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const uri = buildTasksSocketUri(base);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (taskId === null) {
      setConnState('idle');
      return;
    }
    // 换任务 = 换一条流：先清空，免得上一轮的行残留在新任务的输出里。
    dispatch({ kind: 'reset' });
    lastSeqRef.current = 0;
    reportedAnomalyRef.current = false;

    // 生命周期钉在 taskId 上：换 taskId ⇒ effect 重建 ⇒ 这里重新置 false（同 ① 的思路，
    // 不靠另一个 useEffect 去追时序）。
    exitSeenRef.current = false;
    // 握手被拒的码只呈现一次：退避会重试到上限，不去重就会刷出一串一模一样的红字。
    let handshakeErrorSeen: string | null = null;

    const socket = new TaskSocket({
      uri,
      // ⚠️ 在 effect **体内**现算，且只把 `sandboxId`（字符串）放进 deps。
      // 若把 query 对象提到渲染期算好再传进来，每次渲染都是新对象 ⇒ deps 每次都变 ⇒
      // 连接 effect 反复自我拆除（P0 那个 bug 的同一形状）。
      query: buildTasksSocketQuery(sandboxId),
      socketFactory,
      maxReconnect,
      onFrame: (frame) => {
        dispatch({ kind: 'frame', frame });
        if (frame.type !== 'exit') return;
        // **只在 null→exit 的跃迁上回调一次**：重新 subscribe 必定补发 exit，
        // 不去重的话每次重连都要多打一次 GET /tasks。
        if (exitSeenRef.current) return;
        exitSeenRef.current = true;
        onExitRef.current?.({
          status: frame.status,
          ...(frame.exitCode === undefined ? {} : { exitCode: frame.exitCode }),
        });
      },
      onInvalidFrame: (raw) => {
        reportError('丢弃非法 /tasks 帧（TaskServerFrame zod 校验失败）', { raw });
      },
      onUnauthorized: () => {
        onUnauthorizedRef.current?.();
      },
      onHandshakeError: (code) => {
        // 握手期被拒（X-Schema-Hash 不匹配等）与通道级 `error` 帧是同一件事：
        // 都是"这条通道给了一个码"。喂进同一个 reducer ⇒ 复用同一套人话与呈现，
        // 不为握手另造一条文案路径。
        if (handshakeErrorSeen === code) return;
        handshakeErrorSeen = code;
        dispatch({ kind: 'frame', frame: { type: 'error', taskId, code } });
      },
      onState: (state, nextAttempt) => {
        setConnState(state);
        setAttempt(nextAttempt);
        if (state === 'open') {
          // 首连与每次重连都走这里：fromSeq=0 ⇒ 请后端从头回放（刷新恢复）；
          // >0 ⇒ 只补这之后的（断线重连，fromSeq **排他**）。前端不做任何全量 REST 回拉。
          const fromSeq = lastSeqRef.current;
          // 先记账再发帧：caught_up.firstSeq 要跟 fromSeq+1 比才能判断回放有没有被砍头。
          dispatch({ kind: 'subscribed', fromSeq });
          socket.send(buildSubscribeFrame(taskId, fromSeq));
          return;
        }
        if (state === 'reconnecting') {
          // 终态已到 ⇒ 这条流不会再有新东西：不再重连。继续重连只会换来一次完整回放
          // + 一帧补发的 exit，纯粹是白花的代价。
          if (exitSeenRef.current) {
            socket.close();
            return;
          }
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
      // 显式退订再断开：让后端及时释放这一路推送（断开本身也会，但退订语义更清楚）。
      socket.send({ type: 'unsubscribe', taskId });
      socket.close();
      socketRef.current = null;
    };
    // 回调走 latest-ref，不入 deps（P0 同理）。sandboxId 进 deps 是**字符串**：换沙箱＝换归属，
    // 必须重建连接；而字符串等值比较天然稳定，不会因渲染而抖动。
  }, [uri, sandboxId, taskId, socketFactory, maxReconnect, clearTimer]);

  const reconnect = useCallback((): void => {
    // 终态已到 ⇒ 这条流不会再有新东西（后端契约：终态任务重新 subscribe 必定补发 exit），
    // 重连只换来一次完整回放 + 一帧 exit，纯属白花。视图那边此时也不渲染断开态。
    if (exitSeenRef.current) return;
    // 可能还压着一个已排期的退避重连：先撤掉，免得手动这次和它撞成两条连接。
    clearTimer();
    // TaskSocket#reconnect 只清零退避预算，**不动 lastSeqRef** ⇒ 重连后照旧带 fromSeq 续播。
    socketRef.current?.reconnect();
  }, [clearTimer]);

  return {
    connState,
    attempt,
    stream,
    ...(seqAnomaly === null ? {} : { seqAnomalyMessage: describeSeqAnomaly(seqAnomaly) }),
    reconnect,
  };
}
