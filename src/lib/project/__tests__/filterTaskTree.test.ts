// `filterProjectGroups`：左侧任务树的搜索 + 状态筛选（P21-1 §6 六档口径）。
// 硬要求：六个 chip 每一档都要有用例；搜索要覆盖"搜不到时说什么"（`hasActiveFilter` +
// `matchedTaskCount === 0`，调用方据此渲染空态）。
import { describe, it, expect } from 'vitest';
import { filterProjectGroups } from '@/lib/project/filterTaskTree';
import type { ProjectGroup, Sandbox, TaskStatusFilter } from '@/types/domain';

function task(overrides: Partial<Sandbox> & Pick<Sandbox, 'id' | 'name'>): Sandbox {
  return {
    projectId: 'p1',
    status: 'running',
    waitingInput: false,
    lastActiveAt: 0,
    ...overrides,
  };
}

const groups: ProjectGroup[] = [
  {
    projectId: 'p1',
    projectName: 'ProjectA',
    cloneStatus: 'ready',
    collapsed: false,
    taskCount: 4,
    tasks: [
      task({ id: 't1', name: 'Codex · 重构支付模块', status: 'running', waitingInput: false }),
      task({ id: 't2', name: 'Claude Code · 修复终端断线', status: 'running', waitingInput: true }),
      task({ id: 't3', name: 'Codex · 重建 ETL 任务', status: 'paused', waitingInput: false }),
      task({ id: 't5', name: '分析新分支的准备任务', status: 'preparing', waitingInput: false }),
    ],
  },
  {
    projectId: 'p2',
    projectName: 'ProjectB',
    cloneStatus: 'ready',
    collapsed: false,
    taskCount: 1,
    tasks: [task({ id: 't4', name: '分析埋点缺口', projectId: 'p2', status: 'error' })],
  },
];

describe('filterProjectGroups · 全部（无过滤）', () => {
  it('query 为空 + status=all ⇒ 原样返回，不改分组/任务', () => {
    const result = filterProjectGroups(groups, { query: '', status: 'all' });
    expect(result.hasActiveFilter).toBe(false);
    expect(result.groups).toBe(groups); // 原样返回，不拷贝
    expect(result.matchedTaskCount).toBe(5);
  });

  it('query 只有空白 ⇒ 等同于空', () => {
    const result = filterProjectGroups(groups, { query: '   ', status: 'all' });
    expect(result.hasActiveFilter).toBe(false);
  });
});

describe('filterProjectGroups · 状态 chips', () => {
  /**
   * ⭐ 「运行中」与「等待输入」互斥：running 且 waitingInput=true 的任务只算等待输入，
   * 不该同时出现在两边。
   * 变异：把 `matchesStatus` 的 'running' 分支去掉 `&& !task.waitingInput`
   * ⇒ t2（waitingInput=true）会混进「运行中」结果，任务数变成 2 而不是 1。
   */
  it('运行中 chip：只保留 running 且未等待输入的任务', () => {
    const result = filterProjectGroups(groups, { query: '', status: 'running' });
    expect(result.matchedTaskCount).toBe(1);
    expect(result.groups[0]?.tasks.map((t) => t.id)).toEqual(['t1']);
  });

  /** 变异：把 'waitingInput' 分支改成恒 true ⇒ 本例会把 t1/t3 也算进来。 */
  it('等待输入 chip：只保留 waitingInput === true 的任务', () => {
    const result = filterProjectGroups(groups, { query: '', status: 'waitingInput' });
    expect(result.matchedTaskCount).toBe(1);
    expect(result.groups[0]?.tasks.map((t) => t.id)).toEqual(['t2']);
  });

  /** 变异：把 'paused' 分支改成 `task.status !== 'paused'`（取反）⇒ 本例会挑出 t1/t2/t4。 */
  it('已暂停 chip：只保留 status === paused 的任务', () => {
    const result = filterProjectGroups(groups, { query: '', status: 'paused' });
    expect(result.matchedTaskCount).toBe(1);
    expect(result.groups[0]?.tasks.map((t) => t.id)).toEqual(['t3']);
  });

  /**
   * 六档新增两档之一。变异：把 'preparing' 分支改成恒 true（或改判别别的 status 值）
   * ⇒ 本例会把不该算进来的任务也挑出来。
   */
  it('准备中 chip：只保留 status === preparing 的任务', () => {
    const result = filterProjectGroups(groups, { query: '', status: 'preparing' });
    expect(result.matchedTaskCount).toBe(1);
    expect(result.groups.flatMap((g) => g.tasks.map((t) => t.id))).toEqual(['t5']);
  });

  /** 六档新增两档之二。变异：把 'error' 分支改成 `task.status !== 'error'` ⇒ 挑出错误的集合。 */
  it('异常 chip：只保留 status === error 的任务', () => {
    const result = filterProjectGroups(groups, { query: '', status: 'error' });
    expect(result.matchedTaskCount).toBe(1);
    expect(result.groups.flatMap((g) => g.tasks.map((t) => t.id))).toEqual(['t4']);
  });

  it('状态筛选过滤到 0 条的项目组整组不出现（不留空壳组头）', () => {
    const result = filterProjectGroups(groups, { query: '', status: 'paused' });
    // ProjectB 没有 paused 任务 ⇒ 整组消失，不是渲染成一个 0 条的空组。
    expect(result.groups.map((g) => g.projectId)).toEqual(['p1']);
  });

  it('过滤时任务数徽标改用「可见任务数」，不再是后端权威总数', () => {
    const result = filterProjectGroups(groups, { query: '', status: 'paused' });
    expect(result.groups[0]?.taskCount).toBe(1); // 不是原来的 3
  });
});

/**
 * ⭐⭐ 硬要求钉子（用户裁决）：喂进**覆盖全部六个 `SandboxStatus`**（含没有对应 chip 的
 * `'stopped'`）的数据集，一次性断言五个具体 chip 之间互不重叠、互不遗漏，
 * ⛔ 不是"逐档各测各的"（上面几条按档单测的用例仍然保留，但这一条才是防重复/防漏的
 * 唯一权威判据）。
 *
 * `'stopped'`（已停止）在 P21-1 §6 的六档里**没有对应 chip**——这不是本次实现漏掉了
 * 一档，产品文档给的六档本来就只有"全部/准备中/运行中/等待输入/已暂停/异常"，`stopped`
 * 只落在"全部"里。见 `filterTaskTree.ts` 顶部说明与本任务报告里的书面说明。
 */
describe('filterProjectGroups · 六档命中数之和 = 全部档命中数（覆盖全部状态的数据集）', () => {
  const allStatuses: ProjectGroup[] = [
    {
      projectId: 'pAll',
      projectName: 'ProjectAll',
      cloneStatus: 'ready',
      collapsed: false,
      taskCount: 6,
      tasks: [
        task({ id: 's-preparing', name: '准备中的任务', status: 'preparing', waitingInput: false }),
        task({ id: 's-running', name: '运行中的任务', status: 'running', waitingInput: false }),
        task({ id: 's-waiting', name: '等待输入的任务', status: 'running', waitingInput: true }),
        task({ id: 's-paused', name: '已暂停的任务', status: 'paused', waitingInput: false }),
        task({ id: 's-error', name: '异常的任务', status: 'error', waitingInput: false }),
        // ⚠️ 六档里没有它的位置——只应出现在"全部"里，五个具体 chip 一个都不该命中它。
        task({ id: 's-stopped', name: '已停止的任务', status: 'stopped', waitingInput: false }),
      ],
    },
  ];

  const FIVE_SPECIFIC_CHIPS: readonly Exclude<TaskStatusFilter, 'all'>[] = [
    'preparing',
    'running',
    'waitingInput',
    'paused',
    'error',
  ];

  /**
   * MUTATION 覆盖：
   *  · 把 'running' 分支的 `&& !task.waitingInput` 去掉 ⇒ 's-waiting' 同时落进
   *    running 与 waitingInput 两个 chip ⇒ 第一条"不重复"断言红；
   *  · 把 'waitingInput' 分支改成恒 true ⇒ 其余四个 chip 之外的任务全部混进来 ⇒
   *    两条断言都红；
   *  · 给 'stopped' 误接一个具体 chip（比如让 'paused' 也匹配 'stopped'）⇒
   *    "not.toContain('s-stopped')" 与"sum = all - 1"两条都红。
   */
  it('五个具体 chip 的命中 id 互不重叠、并集正好是除 stopped 外的全部任务', () => {
    const all = filterProjectGroups(allStatuses, { query: '', status: 'all' });
    expect(all.matchedTaskCount).toBe(6);

    const perChipIds = FIVE_SPECIFIC_CHIPS.map((status) =>
      filterProjectGroups(allStatuses, { query: '', status }).groups.flatMap((g) =>
        g.tasks.map((t) => t.id),
      ),
    );
    const unionIds = perChipIds.flat();

    // 不重复计入：拼起来的 id 去重前后长度一致 ⇒ 没有任何一条任务同时落进两个 chip。
    expect(new Set(unionIds).size).toBe(unionIds.length);
    // 不遗漏、不误伤：并集精确等于除 stopped 外的那 5 条，一个不多一个不少。
    expect(new Set(unionIds)).toEqual(
      new Set(['s-preparing', 's-running', 's-waiting', 's-paused', 's-error']),
    );
    // stopped 是六档里唯一无处安放的状态：五个具体 chip 一个都不该命中它。
    expect(unionIds).not.toContain('s-stopped');

    // ⭐ 硬要求原句：「六档命中数之和 = 全部档的数量」——五个具体 chip 的命中数相加，
    // 应等于"全部"命中数减去那一条被文档明确排除在六档之外的 stopped 任务。
    const sumOfFiveSpecificChips = perChipIds.reduce((sum, ids) => sum + ids.length, 0);
    expect(sumOfFiveSpecificChips).toBe(all.matchedTaskCount - 1);
  });
});

describe('filterProjectGroups · 搜索', () => {
  it('大小写不敏感的子串匹配（对 task.name）', () => {
    const result = filterProjectGroups(groups, { query: 'codex', status: 'all' });
    expect(result.matchedTaskCount).toBe(2);
    expect(result.groups.flatMap((g) => g.tasks.map((t) => t.id))).toEqual(['t1', 't3']);
  });

  /**
   * ⭐ 「搜不到时说什么」硬要求钉子：搜不到任何任务 ⇒ `groups` 为空数组，
   * `hasActiveFilter: true`，`matchedTaskCount: 0` —— 调用方据此渲染"没有找到匹配的任务"，
   * 而不是把它误判成"这个项目本来就没有任务"（那是 `hasActiveFilter: false` 的情形）。
   */
  it('搜不到任何任务 ⇒ groups 为空、hasActiveFilter 为真、matchedTaskCount 为 0', () => {
    const result = filterProjectGroups(groups, { query: '不存在的任务名', status: 'all' });
    expect(result.groups).toEqual([]);
    expect(result.hasActiveFilter).toBe(true);
    expect(result.matchedTaskCount).toBe(0);
  });

  it('搜索词 + 状态筛选是 AND 关系', () => {
    const result = filterProjectGroups(groups, { query: 'codex', status: 'paused' });
    expect(result.groups.flatMap((g) => g.tasks.map((t) => t.id))).toEqual(['t3']);
  });
});
