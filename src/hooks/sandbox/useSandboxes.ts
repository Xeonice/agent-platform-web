// 工作台左侧任务树的取数（15 §5）：一次拿**全部项目**的 sandbox，交给 lib 纯函数分组。
import { useEffect, useState } from 'react';
import { isSandboxStuck, taskPhaseLabel } from '@/lib/sandbox/taskPresentation';
import { formatElapsed } from '@/lib/sandbox/instanceStartupCopy';
import { useAppStore } from '@/stores';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listSandboxes } from '@/services/api/sandbox.service';
import { toDisplayStatus } from '@/lib/sandbox/sandboxLifecycle';
import type { Sandbox } from '@/types/domain';

export const sandboxListKeys = {
  list: () => ['sandboxes', 'list'] as const,
};

/**
 * `GET /api/sandboxes`（不带 `projectId` = 全部项目）。
 *
 * ★ 2026-08 新增。此前 `WorkbenchContainer` 把树的 tasks 实参写死成一个常量空数组
 * （`const NO_TASKS: Sandbox[] = []`，注释是"sandbox 列表端点在后续切片接入"），
 * 于是**无论后端有多少任务，树里永远是 0 条**。而项目后面的计数走的是另一条路
 * （`ProjectDto.taskCount`，后端权威）⇒ 界面上出现"写着 ·1、展开却一条都没有"。
 *
 * 后端侧同批修了 `list()` 缺省返回空的问题（10 §6）——两处都得改，只改一边都还是空。
 */
export function useSandboxes(): UseQueryResult<Sandbox[]> {
  const states = useAppStore((s) => s.sandboxStatuses);
  const installs = useAppStore((s) => s.runtimeInstalls);
  const [now, setNow] = useState(() => Date.now());
  const preparing = Object.values(states).some((s) =>
    ['pending', 'scheduling', 'preparing-workspace', 'creating', 'starting'].includes(s.status),
  );
  useEffect(() => {
    if (!preparing) return;
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [preparing]);
  return useQuery({
    queryKey: sandboxListKeys.list(),
    // 包一层：queryFn 会把 QueryFunctionContext 当第一个实参传进去，
    // 裸给 listSandboxes 会被当成 projectId。
    queryFn: async () => {
      const before = useAppStore.getState().sandboxStatuses;
      const dtos = await listSandboxes();
      for (const dto of dtos) {
        const current = useAppStore.getState();
        // A WS update arriving while REST is in flight remains authoritative.
        if (current.sandboxStatuses[dto.id] !== before[dto.id]) continue;
        current.setSandboxStatus(dto.id, dto.status, {
          failureCode: dto.failureCode,
          failureMessage: dto.failureMessage,
          failureOperation: dto.failureOperation,
          restarting: dto.hasRun === true && dto.status === 'starting',
        });
      }
      return dtos;
    },
    // DTO → 领域映射放在 hook 层：container 不允许 import lib
    // （eslint boundaries：container ✗ lib），而 status 的词汇转换必须用 lib 里的
    // `toDisplayStatus`。放这儿也更对——container 只该消费领域类型，不该做形状转换。
    select: (dtos): Sandbox[] =>
      dtos.map((dto) => {
        const state = states[dto.id];
        const rawStatus = state?.status ?? dto.status;
        const lastProgressAt = state?.lastProgressAt ?? now;
        const stuck = isSandboxStuck(
          rawStatus,
          lastProgressAt,
          now,
          installs[dto.id]?.status === 'installing',
        );
        const dateValue = dto.updatedAt;
        return {
          id: dto.id,
          projectId: dto.projectId,
          name: dto.name,
          status: toDisplayStatus(rawStatus),
          rawStatus,
          waitingInput: dto.waitingInput && rawStatus === 'running',
          lastActiveAt: typeof dateValue === 'string' ? Date.parse(dateValue) : 0,
          phaseLabel: taskPhaseLabel(
            rawStatus,
            state?.failureCode ?? dto.failureCode,
            state?.failureOperation ?? dto.failureOperation,
          ),
          failureCode: state?.failureCode ?? dto.failureCode,
          failureOperation: state?.failureOperation ?? dto.failureOperation,
          sourceAutomationId: dto.sourceAutomationId,
          sourceAutomationName: dto.sourceAutomationName,
          stuck,
          stuckElapsed: formatElapsed(now - lastProgressAt),
        };
      }),
  });
}
