// 左侧任务树的搜索 + 状态筛选（P21-1 §6 六档口径：全部/准备中/运行中/等待输入/已暂停/异常）。
// 纯函数，输入已经分好组的 `ProjectGroup[]`（`selectProjectTaskTree` 的输出），只做二次
// 过滤，不改分组/排序/折叠。
//
// ⚠️ 这两个控件在原型（design-notes.md 四档版本）里是**纯装饰**（静态 HTML，点了没有真
// 过滤）。硬要求：这一轮必须是真功能——每个 chip 都有落地的过滤谓词，搜索要能说清
// "搜不到时说什么"（见 `TaskTreeFilterResult.hasActiveFilter` + `matchedTaskCount`，
// 调用方据此渲染空态文案）。
//
// ⚠️ **六档 ≠ `SandboxStatus` 的全部取值**：`SandboxStatus` 有 6 个值，但产品文档 §6
// 给的六档 chip 集合是「全部/准备中/运行中/等待输入/已暂停/异常」——`'stopped'`（已停止）
// 不在其中，落到"全部"里但不落进任何一个具体 chip。这不是本次实现漏掉了一档，是产品
// 文档六档本身就没有给"已停止"留位置；`__tests__/filterTaskTree.test.ts` 里有一条用例
// 专门断言这一点（stopped 任务出现在"全部"计数里、但五个具体 chip 一个都不命中它）。
import type { ProjectGroup, Sandbox, TaskStatusFilter } from '@/types/domain';

export interface TaskTreeFilter {
  /** 原始搜索词，大小写不敏感、去首尾空白后做子串匹配（对 `task.name`）。 */
  query: string;
  status: TaskStatusFilter;
}

export interface TaskTreeFilterResult {
  groups: ProjectGroup[];
  /** query 非空或 status !== 'all'。调用方据此决定"过滤后 0 条"要不要说成"没搜到"。 */
  hasActiveFilter: boolean;
  /** 过滤后剩下的任务总数（跨全部项目）。 */
  matchedTaskCount: number;
}

function matchesStatus(task: Sandbox, status: TaskStatusFilter): boolean {
  switch (status) {
    case 'preparing':
      return task.status === 'preparing';
    case 'running':
      // 「运行中」与「等待输入」是互斥的两个 chip：waitingInput 是 running 的子态
      // （domain.ts 注释），算进「运行中」会让同一条任务同时出现在两个筛选结果里。
      return task.status === 'running' && !task.waitingInput;
    case 'waitingInput':
      return task.waitingInput;
    case 'paused':
      return task.status === 'paused';
    case 'error':
      return task.status === 'error';
    case 'all':
    default:
      return true;
  }
}

/**
 * 对已分组的任务树做搜索 + 状态过滤。
 *
 * - 两者是 **AND** 关系：搜索词与状态筛选同时生效时，任务必须两者都满足。
 * - 过滤后一个任务都不剩的项目组**整组不渲染**（不留一个空壳组头）。
 * - 没有任何激活的过滤条件（`query` 为空白 + `status==='all'`）⇒ 原样返回输入，
 *   不做任何拷贝/改写——默认视图（含允许存在的空组）与过滤前完全一致。
 */
export function filterProjectGroups(
  groups: ProjectGroup[],
  filter: TaskTreeFilter,
): TaskTreeFilterResult {
  const query = filter.query.trim().toLowerCase();
  const hasQuery = query.length > 0;
  const hasStatusFilter = filter.status !== 'all';
  const hasActiveFilter = hasQuery || hasStatusFilter;

  if (!hasActiveFilter) {
    const matchedTaskCount = groups.reduce((sum, g) => sum + g.tasks.length, 0);
    return { groups, hasActiveFilter: false, matchedTaskCount };
  }

  const filtered: ProjectGroup[] = [];
  let matchedTaskCount = 0;
  for (const group of groups) {
    const tasks = group.tasks.filter(
      (task) =>
        matchesStatus(task, filter.status) &&
        (!hasQuery || task.name.toLowerCase().includes(query)),
    );
    if (tasks.length === 0) continue;
    matchedTaskCount += tasks.length;
    // 过滤时以"实际可见任务数"顶替后端权威计数——继续显示未过滤的总数会让人以为
    // 筛出来的 1 条之外还藏着别的，而它们其实被过滤掉了。
    filtered.push({ ...group, taskCount: tasks.length, tasks });
  }
  return { groups: filtered, hasActiveFilter: true, matchedTaskCount };
}
