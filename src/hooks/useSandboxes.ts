// 工作台左侧任务树的取数（15 §5）：一次拿**全部项目**的 sandbox，交给 lib 纯函数分组。
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
  return useQuery({
    queryKey: sandboxListKeys.list(),
    // 包一层：queryFn 会把 QueryFunctionContext 当第一个实参传进去，
    // 裸给 listSandboxes 会被当成 projectId。
    queryFn: () => listSandboxes(),
    // DTO → 领域映射放在 hook 层：container 不允许 import lib
    // （eslint boundaries：container ✗ lib），而 status 的词汇转换必须用 lib 里的
    // `toDisplayStatus`。放这儿也更对——container 只该消费领域类型，不该做形状转换。
    select: (dtos): Sandbox[] =>
      dtos.map((s) => ({
        id: s.id,
        projectId: s.projectId,
        // 任务名由后端派生（前端不造名字，P20 §9.3）。
        name: s.name,
        status: toDisplayStatus(s.status),
        waitingInput: s.waitingInput,
        // SandboxDto 目前不带时间戳（backlog：补 updatedAt 修 TTL 时钟原点）。
        // 树只用它排序；缺省给 0 而不是 Date.now()——后者会让顺序每次渲染都变。
        lastActiveAt: 0,
      })),
  });
}
