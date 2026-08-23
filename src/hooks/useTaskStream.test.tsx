// /tasks 订阅生命周期（12 §3.2 hooks 层）。本文件钉死 S6 最容易做错的三件事：
//  ① 每次 open 都发 subscribe，**重连时带上 fromSeq**（= 已收到的最大 seq）——刷新恢复走同一条路径；
//  ② 卸载/换任务时显式 unsubscribe；
//  ③ 非法帧被 zod 挡在下游之外，不阻断已渲染的内容；
//  ④ **终态是这条流的终点**：exit 之后不再重连，onExit 也只回调一次
//     （后端"终态任务重新 subscribe 必定补发 exit"⇒ 不封住就是一个由重连驱动的 REST 轮询器）。
// mock socket 走依赖注入（12 §3.1.1：避免 mock.module）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTaskStream } from '@/hooks/useTaskStream';
import { setErrorReporter } from '@/lib/reportError';
import type { TaskSocketFactory, TaskSocketFactoryArgs, TaskSocketLike } from '@/types/taskSocket';
import type { TaskClientFrame } from '@/types/ws-protocol';

class MockTaskSocket implements TaskSocketLike {
  private connectCb: (() => void) | null = null;
  private disconnectCb: (() => void) | null = null;
  private connectErrorCb: ((err?: unknown) => void) | null = null;
  private frameCb: ((raw: unknown) => void) | null = null;
  readonly emitted: TaskClientFrame[] = [];
  disconnected = false;

  onConnect(cb: () => void): void {
    this.connectCb = cb;
  }
  onDisconnect(cb: () => void): void {
    this.disconnectCb = cb;
  }
  onConnectError(cb: (err?: unknown) => void): void {
    this.connectErrorCb = cb;
  }
  onFrame(cb: (raw: unknown) => void): void {
    this.frameCb = cb;
  }
  emitFrame(frame: TaskClientFrame): void {
    this.emitted.push(frame);
  }
  disconnect(): void {
    this.disconnected = true;
  }

  triggerConnect(): void {
    this.connectCb?.();
  }
  triggerDisconnect(): void {
    this.disconnectCb?.();
  }
  triggerConnectError(err?: unknown): void {
    this.connectErrorCb?.(err);
  }
  serverEmit(raw: unknown): void {
    this.frameCb?.(raw);
  }
}

function makeFactory(): {
  factory: TaskSocketFactory;
  sockets: MockTaskSocket[];
  calls: TaskSocketFactoryArgs[];
} {
  const sockets: MockTaskSocket[] = [];
  const calls: TaskSocketFactoryArgs[] = [];
  const factory: TaskSocketFactory = (args) => {
    calls.push(args);
    const socket = new MockTaskSocket();
    sockets.push(socket);
    return socket;
  };
  return { factory, sockets, calls };
}

const BASE = 'ws://localhost:3001';
const SANDBOX = 'sb-1';
const TASK = 'task-1';

function event(seq: number, text: string): unknown {
  return {
    type: 'event',
    taskId: TASK,
    seq,
    // agent-message = agent 自己的正文（7 值里最主要的那条）。
    event: { type: 'agent-message', timestamp: '2026-08-22T00:00:00.000Z', data: { text } },
  };
}

afterEach(() => {
  setErrorReporter(null);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useTaskStream · 订阅与恢复', () => {
  it('taskId=null ⇒ 完全不建连接', () => {
    const { factory, calls } = makeFactory();
    renderHook(() =>
      useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: null, socketFactory: factory }),
    );
    expect(calls).toHaveLength(0);
  });

  it('open 即发 subscribe；首次订阅**不带 fromSeq**（请后端从头回放）', () => {
    const { factory, sockets, calls } = makeFactory();
    renderHook(() =>
      useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: TASK, socketFactory: factory }),
    );

    expect(calls[0]?.uri).toBe('http://localhost:3001/tasks');
    // 握手带版本标识（跨仓帧协议漂移在握手期就能发现）。
    expect(calls[0]?.query['xSchemaHash']).toBe('sb-tasks-v1');

    act(() => {
      sockets[0]?.triggerConnect();
    });
    expect(sockets[0]?.emitted).toEqual([{ type: 'subscribe', taskId: TASK }]);
  });

  it('握手 query 带 sandboxId ⇒ 后端能做订阅归属校验（不带就只能"没带放行"）', () => {
    const { factory, calls } = makeFactory();
    renderHook(() =>
      useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: TASK, socketFactory: factory }),
    );

    expect(calls[0]?.query['sandboxId']).toBe(SANDBOX);
    // taskId **不**在 query 里：一条连接可以换订阅目标，归属才是连接级属性。
    expect(calls[0]?.query['taskId']).toBeUndefined();
  });

  it('每次重连都重新带上 sandboxId（重连是新一次握手，漏带就退回"没带放行"）', () => {
    vi.useFakeTimers();
    const { factory, sockets, calls } = makeFactory();
    renderHook(() =>
      useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: TASK, socketFactory: factory }),
    );

    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.triggerDisconnect();
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.query['sandboxId']).toBe(SANDBOX);
  });

  it('换沙箱 ⇒ 重建连接并带上新的归属（不能拿旧沙箱的身份继续订阅）', () => {
    const { factory, calls } = makeFactory();
    const { rerender } = renderHook(
      ({ sb }: { sb: string }) =>
        useTaskStream({ base: BASE, sandboxId: sb, taskId: TASK, socketFactory: factory }),
      { initialProps: { sb: SANDBOX } },
    );
    expect(calls).toHaveLength(1);

    rerender({ sb: 'sb-2' });

    expect(calls).toHaveLength(2);
    expect(calls[1]?.query['sandboxId']).toBe('sb-2');
  });

  it('sandboxId 不变时反复重渲染**不**重建连接（query 在 effect 体内现算，对象不进 deps）', () => {
    const { factory, calls } = makeFactory();
    const { rerender } = renderHook(
      ({ n }: { n: number }) =>
        useTaskStream({
          base: BASE,
          sandboxId: SANDBOX,
          taskId: TASK,
          socketFactory: factory,
          onExit: () => void n, // 每次渲染换一个回调引用，模拟父层 deps 抖动
        }),
      { initialProps: { n: 0 } },
    );

    for (let i = 1; i <= 5; i += 1) rerender({ n: i });

    expect(calls).toHaveLength(1);
  });

  it('断线重连 ⇒ 重新 subscribe 并带上 fromSeq=已收到的最大 seq（**不重新拉全量**）', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: TASK, socketFactory: factory }),
    );

    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.serverEmit(event(1, 'a'));
      sockets[0]?.serverEmit(event(2, 'b'));
      sockets[0]?.serverEmit(event(3, 'c'));
    });
    expect(result.current.stream.lastSeq).toBe(3);

    // 掉线 → hook 依退避安排重连。
    act(() => {
      sockets[0]?.triggerDisconnect();
    });
    expect(result.current.connState).toBe('reconnecting');

    act(() => {
      vi.runOnlyPendingTimers();
    });
    // 同一个 TaskSocket 实例重连 ⇒ 工厂再建一条底层 socket。
    expect(sockets).toHaveLength(2);

    act(() => {
      sockets[1]?.triggerConnect();
    });
    expect(sockets[1]?.emitted).toEqual([{ type: 'subscribe', taskId: TASK, fromSeq: 3 }]);
    // 已渲染的内容不因重连丢失（回放只补缺的那截）。
    expect(result.current.stream.items).toHaveLength(3);
  });

  it('刷新恢复语义：拿着 taskId 重新挂载 ⇒ 从头订阅一次，不发任何全量 REST', () => {
    const { factory, sockets } = makeFactory();
    // 「刷新」= 新的 hook 实例、内存为空 ⇒ lastSeq 0 ⇒ subscribe 不带 fromSeq。
    renderHook(() =>
      useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: TASK, socketFactory: factory }),
    );
    act(() => {
      sockets[0]?.triggerConnect();
    });
    expect(sockets[0]?.emitted).toEqual([{ type: 'subscribe', taskId: TASK }]);
  });

  it('卸载 ⇒ 显式 unsubscribe 再断开', () => {
    const { factory, sockets } = makeFactory();
    const { unmount } = renderHook(() =>
      useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: TASK, socketFactory: factory }),
    );
    act(() => {
      sockets[0]?.triggerConnect();
    });

    unmount();

    expect(sockets[0]?.emitted).toEqual([
      { type: 'subscribe', taskId: TASK },
      { type: 'unsubscribe', taskId: TASK },
    ]);
    expect(sockets[0]?.disconnected).toBe(true);
  });

  it('换任务 ⇒ 上一条流清空，不残留上一轮的行', () => {
    const { factory, sockets } = makeFactory();
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: id, socketFactory: factory }),
      { initialProps: { id: TASK } },
    );
    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.serverEmit(event(1, 'old task output'));
    });
    expect(result.current.stream.items).toHaveLength(1);

    rerender({ id: 'task-2' });
    expect(result.current.stream.items).toHaveLength(0);
    expect(result.current.stream.lastSeq).toBe(0);
  });
});

describe('useTaskStream · 帧处理', () => {
  it('非法帧被 zod 挡下并上报，已渲染内容不受影响', () => {
    const reported: string[] = [];
    setErrorReporter((message) => reported.push(message));
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: TASK, socketFactory: factory }),
    );

    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.serverEmit(event(1, 'ok'));
      sockets[0]?.serverEmit({ type: 'totally-unknown', nope: true });
    });

    expect(result.current.stream.items).toHaveLength(1);
    expect(reported.some((m) => m.includes('非法 /tasks 帧'))).toBe(true);
  });

  it('exit 帧 ⇒ 回调拿到状态；**exitCode 缺席时不伪造 0**', () => {
    const onExit = vi.fn();
    const { factory, sockets } = makeFactory();
    renderHook(() =>
      useTaskStream({
        base: BASE,
        sandboxId: SANDBOX,
        taskId: TASK,
        socketFactory: factory,
        onExit,
      }),
    );

    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.serverEmit({ type: 'exit', taskId: TASK, status: 'timed_out' });
    });

    expect(onExit).toHaveBeenCalledWith({ status: 'timed_out' });
  });

  it('seq 缺口 ⇒ 上报一次 + 给出人话（不做任何本地补拉）', () => {
    const reported: string[] = [];
    setErrorReporter((message) => reported.push(message));
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: TASK, socketFactory: factory }),
    );

    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.serverEmit(event(1, 'a'));
      sockets[0]?.serverEmit(event(5, 'e'));
    });

    expect(result.current.seqAnomalyMessage).toContain('缺口');
    expect(result.current.stream.subscribedFromSeq).toBe(0);
    expect(reported.filter((m) => m.includes('seq 异常'))).toHaveLength(1);
    // 缺口不触发任何"重新拉全量"：连接数与已发帧都没变多。
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.emitted).toEqual([{ type: 'subscribe', taskId: TASK }]);
  });

  it('X-Schema-Hash 不匹配 ⇒ 渲染成通道级错误的人话（**不**弹解锁门）', () => {
    const onUnauthorized = vi.fn();
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useTaskStream({
        base: BASE,
        sandboxId: SANDBOX,
        taskId: TASK,
        socketFactory: factory,
        onUnauthorized,
      }),
    );

    act(() => {
      sockets[0]?.triggerConnectError(
        Object.assign(new Error('SCHEMA_MISMATCH: expected sb-tasks-v1, got sb-tasks-v0'), {
          data: { code: 'SCHEMA_MISMATCH' },
        }),
      );
    });

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(result.current.stream.channelErrorCode).toBe('SCHEMA_MISMATCH');
    expect(result.current.stream.items).toHaveLength(1);
    expect(result.current.stream.items[0]?.text).toContain('刷新');
  });

  it('退避重试期间同一个握手码只呈现一次（不刷出一串一模一样的红字）', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: TASK, socketFactory: factory }),
    );

    const reject = (socket: MockTaskSocket | undefined): void => {
      socket?.triggerConnectError(
        Object.assign(new Error('SCHEMA_MISMATCH: expected sb-tasks-v1, got sb-tasks-v0'), {
          data: { code: 'SCHEMA_MISMATCH' },
        }),
      );
    };

    act(() => {
      reject(sockets[0]);
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });
    act(() => {
      reject(sockets[1]);
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });
    act(() => {
      reject(sockets[2]);
    });

    expect(sockets.length).toBeGreaterThan(2); // 确实重试了
    expect(result.current.stream.items).toHaveLength(1);
  });

  it('未授权握手失败 ⇒ 通知上层弹解锁门', () => {
    const onUnauthorized = vi.fn();
    const { factory, sockets } = makeFactory();
    renderHook(() =>
      useTaskStream({
        base: BASE,
        sandboxId: SANDBOX,
        taskId: TASK,
        socketFactory: factory,
        onUnauthorized,
      }),
    );

    act(() => {
      sockets[0]?.triggerConnectError(new Error('unauthorized'));
    });
    expect(onUnauthorized).toHaveBeenCalled();
  });
});

describe('useTaskStream · 终态即终点（S6 review ③）', () => {
  it('同一条流上补发的 exit 不再触发第二次 onExit（否则每次重放都多打一次 GET /tasks）', () => {
    const onExit = vi.fn();
    const { factory, sockets } = makeFactory();
    renderHook(() =>
      useTaskStream({
        base: BASE,
        sandboxId: SANDBOX,
        taskId: TASK,
        socketFactory: factory,
        onExit,
      }),
    );

    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.serverEmit({ type: 'exit', taskId: TASK, status: 'succeeded', exitCode: 0 });
      // 后端契约：终态任务重新 subscribe **必定补发 exit** ⇒ 这一帧在真实链路上一定会再来。
      sockets[0]?.serverEmit({ type: 'exit', taskId: TASK, status: 'succeeded', exitCode: 0 });
    });

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('终态之后掉线 ⇒ 不再重连（不会再建一条 socket、也不会再回放一遍）', () => {
    vi.useFakeTimers();
    const onExit = vi.fn();
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useTaskStream({
        base: BASE,
        sandboxId: SANDBOX,
        taskId: TASK,
        socketFactory: factory,
        onExit,
      }),
    );

    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.serverEmit({ type: 'exit', taskId: TASK, status: 'killed' });
    });
    act(() => {
      sockets[0]?.triggerDisconnect();
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(sockets).toHaveLength(1);
    expect(result.current.connState).toBe('closed');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('**没有**终态时掉线照旧重连（别把降级做成"永不重连"）', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    renderHook(() =>
      useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: TASK, socketFactory: factory }),
    );

    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.triggerDisconnect();
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(sockets).toHaveLength(2);
  });

  it('换任务后 exit 去重自动归零（新任务的 exit 照常回调）', () => {
    const onExit = vi.fn();
    const { factory, sockets } = makeFactory();
    const { rerender } = renderHook(
      ({ id }: { id: string }) =>
        useTaskStream({
          base: BASE,
          sandboxId: SANDBOX,
          taskId: id,
          socketFactory: factory,
          onExit,
        }),
      { initialProps: { id: TASK } },
    );

    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.serverEmit({ type: 'exit', taskId: TASK, status: 'succeeded', exitCode: 0 });
    });
    rerender({ id: 'task-2' });
    act(() => {
      sockets[1]?.triggerConnect();
    });
    act(() => {
      sockets[1]?.serverEmit({ type: 'exit', taskId: 'task-2', status: 'failed', exitCode: 1 });
    });

    expect(onExit).toHaveBeenCalledTimes(2);
  });
});

describe('useTaskStream · 回放被砍头（caught_up.firstSeq）', () => {
  it('从头订阅但后端只回放得到 25 起 ⇒ 报"开头缺失"而不是把残缺记录当完整的渲染', () => {
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: TASK, socketFactory: factory }),
    );

    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.serverEmit(event(25, '半截记录'));
      sockets[0]?.serverEmit({ type: 'caught_up', taskId: TASK, firstSeq: 25, seq: 25 });
    });

    expect(result.current.stream.caughtUp).toBe(true);
    expect(result.current.seqAnomalyMessage).toContain('开头');
  });

  it('重连后的空回放（firstSeq = seq + 1）不误报', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: TASK, socketFactory: factory }),
    );

    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.serverEmit(event(1, 'a'));
      sockets[0]?.serverEmit({ type: 'caught_up', taskId: TASK, firstSeq: 1, seq: 1 });
    });
    act(() => {
      sockets[0]?.triggerDisconnect();
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });
    act(() => {
      sockets[1]?.triggerConnect();
    });
    // 重连订阅带 fromSeq=1；这期间没有新事件 ⇒ 空回放。
    expect(sockets[1]?.emitted).toEqual([{ type: 'subscribe', taskId: TASK, fromSeq: 1 }]);
    act(() => {
      sockets[1]?.serverEmit({ type: 'caught_up', taskId: TASK, firstSeq: 2, seq: 1 });
    });

    expect(result.current.seqAnomalyMessage).toBeUndefined();
  });
});

// ————————————————————————————————————————————————————————————————
// 退避耗尽 → 停手 → 「重新连接」（S6 收尾 ③ 的补项）。
// ⚠️ 本节最要紧的一条：重连**续播**而不是重来 —— 用户面前正是一屏看了很久的输出。
// ————————————————————————————————————————————————————————————————
describe('useTaskStream · 退避耗尽与手动重连', () => {
  /** 一轮"连上即掉"（抖动型故障：退避真的增长才撞得到上限）。 */
  function flap(socket: MockTaskSocket | undefined): void {
    act(() => {
      socket?.triggerConnect();
    });
    act(() => {
      socket?.triggerDisconnect();
    });
  }

  it('抖动到上限 ⇒ 停止自动重连并进入 closed（不再无限重建连接）', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useTaskStream({
        base: BASE,
        sandboxId: SANDBOX,
        taskId: TASK,
        socketFactory: factory,
        maxReconnect: 3,
      }),
    );

    for (let i = 0; i < 4; i += 1) {
      flap(sockets.at(-1));
      act(() => {
        vi.runOnlyPendingTimers();
      });
    }

    expect(result.current.connState).toBe('closed');
    const built = sockets.length;
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(sockets).toHaveLength(built);
  });

  it('⚠️ 手动重连**续播不重来**：已渲染的 items 原样保留，subscribe 带上 fromSeq', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useTaskStream({
        base: BASE,
        sandboxId: SANDBOX,
        taskId: TASK,
        socketFactory: factory,
        maxReconnect: 2,
      }),
    );

    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.serverEmit(event(1, 'a'));
      sockets[0]?.serverEmit(event(2, 'b'));
      sockets[0]?.serverEmit(event(3, 'c'));
    });
    expect(result.current.stream.items).toHaveLength(3);

    // 抖到上限 ⇒ 停手。
    for (let i = 0; i < 3; i += 1) {
      flap(sockets.at(-1));
      act(() => {
        vi.runOnlyPendingTimers();
      });
    }
    expect(result.current.connState).toBe('closed');
    // 停手期间那三条输出仍然在屏幕上（用户看着的东西不会因为断线消失）。
    expect(result.current.stream.items).toHaveLength(3);

    const built = sockets.length;
    act(() => {
      result.current.reconnect();
    });
    expect(sockets).toHaveLength(built + 1);
    expect(result.current.connState).toBe('connecting');
    // 预算清零 ⇒ 这次点击换来完整的一轮退避，而不是一次尝试。
    expect(result.current.attempt).toBe(0);

    act(() => {
      sockets.at(-1)?.triggerConnect();
    });

    // **关键**：带 fromSeq=3 续订，而不是从 0 重来。
    expect(sockets.at(-1)?.emitted).toEqual([{ type: 'subscribe', taskId: TASK, fromSeq: 3 }]);
    // 面板没有被清空。
    expect(result.current.stream.items).toHaveLength(3);
    expect(result.current.stream.lastSeq).toBe(3);
  });

  it('重连后续上的新事件接在老的后面（不重复也不丢）', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useTaskStream({
        base: BASE,
        sandboxId: SANDBOX,
        taskId: TASK,
        socketFactory: factory,
        maxReconnect: 1,
      }),
    );

    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.serverEmit(event(1, '老输出'));
    });
    for (let i = 0; i < 2; i += 1) {
      flap(sockets.at(-1));
      act(() => {
        vi.runOnlyPendingTimers();
      });
    }
    expect(result.current.connState).toBe('closed');

    act(() => {
      result.current.reconnect();
    });
    act(() => {
      sockets.at(-1)?.triggerConnect();
    });
    act(() => {
      sockets.at(-1)?.serverEmit(event(2, '新输出'));
    });

    expect(result.current.stream.items.map((i) => i.text)).toEqual(['老输出', '新输出']);
  });

  it('终态已到 ⇒ 手动重连是 no-op（重连只换来一次完整回放 + 一帧补发的 exit）', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    const { result } = renderHook(() =>
      useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: TASK, socketFactory: factory }),
    );

    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.serverEmit({ type: 'exit', taskId: TASK, status: 'succeeded', exitCode: 0 });
    });
    act(() => {
      sockets[0]?.triggerDisconnect();
    });
    const built = sockets.length;

    act(() => {
      result.current.reconnect();
    });

    expect(sockets).toHaveLength(built);
  });

  it('换任务后手动重连恢复可用（终态去重的复位钉在 taskId 上）', () => {
    vi.useFakeTimers();
    const { factory, sockets } = makeFactory();
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) =>
        useTaskStream({ base: BASE, sandboxId: SANDBOX, taskId: id, socketFactory: factory }),
      { initialProps: { id: TASK } },
    );

    act(() => {
      sockets[0]?.triggerConnect();
    });
    act(() => {
      sockets[0]?.serverEmit({ type: 'exit', taskId: TASK, status: 'succeeded', exitCode: 0 });
    });
    rerender({ id: 'task-2' });
    const built = sockets.length;

    act(() => {
      result.current.reconnect();
    });

    // 新任务还没到终态 ⇒ 重连照常生效（上一轮的 exitSeen 没有残留过来）。
    expect(sockets).toHaveLength(built + 1);
  });
});
