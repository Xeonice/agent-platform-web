// 删除凭证前「哪些正在跑的任务会被重启」的**真实**数据源（F21-3 §5 / P0-4）。
//
// ★ 2026-09-11。此前 `useCredentials` 把 `affectedRunningTasks` 的第一个实参写死成 `[]`
//   （注释是「本切片暂无 sandbox 列表 query → 空；接入后传入即联动」），于是删除确认弹层
//   **在任何情况下**都显示「当前无运行中的任务使用该凭证」——包括真有 10 个任务正在跑的时候。
//   用户据此按下删除，任务全被重启。这与 `WorkbenchContainer` 那个 `NO_TASKS` 常量是同一种病，
//   而且这一处的代价更高：那边只是少显示几行，这边是**在一个破坏性操作的确认框上撒谎**。
//
// ⚠️ 走的是**工作台左侧树同一份** `GET /api/sandboxes` 缓存（`sandboxListKeys.list()` +
//    同一个 `queryFn`），所以打开凭证页不会多打一次请求，数字也与树上看到的一致。
//    这里另起一个 `select` 而不是复用 `useSandboxes()`：那一份的 `select` 把 `runtime` 丢了
//    （领域类型 `Sandbox` 没有这个字段），而按 runtime 过滤正是本 hook 唯一要做的事。
//    ⛔ 别在这里改 `staleTime` —— 同一个 queryKey 被两处用不同 staleTime 声明时，什么时候
//    重取取决于哪个观察者先挂载（见 `RUNTIMES_QUERY_OPTIONS` 上那条注释踩过的坑）。
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sandboxListKeys } from '@/hooks/sandbox/useSandboxes';
import { listSandboxes } from '@/services/api/sandbox.service';
import { affectedRunningTasks, type AffectedTasksResult } from '@/lib/credential/affectedTasks';
import type { AffectedTaskInput } from '@/types/runtimeCredential';

/** 受影响任务的查询结果：算得出就给清单，算不出**必须说算不出**。 */
export interface AffectedTasksQuery {
  /**
   * 清单是否**可信**。
   *
   * ⛔ 这一位是本 hook 存在的理由。列表还没到、或者接口挂了的时候，`items` 同样是空数组 ——
   * 把它渲染成「没有任务在跑」就是把「不知道」说成了「没有」，而下一步是一个不可逆操作。
   */
  known: boolean;
  affectedFor: (runtimeId: string) => AffectedTasksResult;
}

const EMPTY: AffectedTaskInput[] = [];

export function useAffectedTasks(): AffectedTasksQuery {
  const sandboxes = useQuery({
    queryKey: sandboxListKeys.list(),
    // 包一层：queryFn 会把 QueryFunctionContext 当第一个实参传进去，
    // 裸给 listSandboxes 会被当成 projectId（与 `useSandboxes` 同一条）。
    queryFn: () => listSandboxes(),
    select: (dtos): AffectedTaskInput[] =>
      dtos.map((s) => ({ id: s.id, name: s.name, runtime: s.runtime, status: s.status })),
  });

  const tasks = sandboxes.data ?? EMPTY;
  // 「拿到过一份数据」才算数：`isPending` 期间与 `isError` 都是「不知道」。
  // 用 `data !== undefined` 而不是 `isSuccess`，这样后台重取失败时仍按手里那份（陈旧但真实）说话。
  const known = sandboxes.data !== undefined;

  return useMemo(
    () => ({
      known,
      affectedFor: (runtimeId: string) => affectedRunningTasks(tasks, runtimeId),
    }),
    [known, tasks],
  );
}
