// 硬超时倒计时（副作用归 hook 层：本地时钟 tick，**不是轮询**——一个网络请求都不发）。
import { useEffect, useState } from 'react';
import { describeTaskDeadline, type TaskDeadlineView } from '@/lib/taskOutcome';

/**
 * 每秒重算一次「还剩多久」。任务已终结（`running === false`）时停表，
 * 不留一个跑到天荒地老的 interval。
 *
 * 入参可选**不是**因为契约里它们可选（两者都是 required），而是因为任务 DTO 本身可能还没加载回来。
 */
export function useTaskDeadline(
  input: { startedAt?: string; timeoutMinutes?: number },
  running: boolean,
): TaskDeadlineView | null {
  const { startedAt, timeoutMinutes } = input;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || startedAt === undefined || timeoutMinutes === undefined) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return (): void => {
      clearInterval(timer);
    };
  }, [running, startedAt, timeoutMinutes]);

  if (startedAt === undefined || timeoutMinutes === undefined) return null;
  return describeTaskDeadline({ startedAt, timeoutMinutes, now });
}
