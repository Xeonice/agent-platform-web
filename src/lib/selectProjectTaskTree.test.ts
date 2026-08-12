import { describe, it, expect } from 'vitest';
import { selectProjectTaskTree, countWaitingInput } from '@/lib/selectProjectTaskTree';
import type { Project, Sandbox } from '@/types/domain';

const projects: Project[] = [
  { id: 'a', name: '项目 A' },
  { id: 'b', name: '项目 B' },
];
const tasks: Sandbox[] = [
  {
    id: 't1',
    projectId: 'a',
    name: 'A-1',
    status: 'running',
    waitingInput: false,
    lastActiveAt: 1,
  },
  { id: 't2', projectId: 'a', name: 'A-2', status: 'running', waitingInput: true, lastActiveAt: 3 },
  { id: 't3', projectId: 'b', name: 'B-1', status: 'paused', waitingInput: false, lastActiveAt: 2 },
  {
    id: 't4',
    projectId: 'ghost',
    name: '孤儿',
    status: 'error',
    waitingInput: false,
    lastActiveAt: 5,
  },
];

describe('selectProjectTaskTree (15 §5)', () => {
  it('按项目分组，组内按 lastActiveAt 倒序', () => {
    const groups = selectProjectTaskTree(projects, tasks, {}, null);
    const a = groups.find((g) => g.projectId === 'a');
    expect(a?.tasks.map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('孤儿 Task 归入「未分组」组并保持可见，绝不丢弃', () => {
    const groups = selectProjectTaskTree(projects, tasks, {}, null);
    const orphan = groups.find((g) => g.projectName === '未分组');
    expect(orphan?.tasks.map((t) => t.id)).toEqual(['t4']);
  });

  it('currentProjectId 组置顶', () => {
    const groups = selectProjectTaskTree(projects, tasks, {}, 'b');
    expect(groups[0]?.projectId).toBe('b');
  });

  it('折叠只标记 collapsed，不改变分组集合与计数', () => {
    const groups = selectProjectTaskTree(projects, tasks, { a: true }, null);
    const a = groups.find((g) => g.projectId === 'a');
    expect(a?.collapsed).toBe(true);
    expect(a?.tasks).toHaveLength(2); // 折叠不移除子项
  });

  it('countWaitingInput 跨全部项目、不受折叠影响', () => {
    expect(countWaitingInput(tasks)).toBe(1);
  });
});
