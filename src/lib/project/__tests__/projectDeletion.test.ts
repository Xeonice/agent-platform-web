// F21-6 §10.6 第 3 条：删除确认里的「运行中任务」警示读的是**真数据**。
// 这个纯函数就是那句话的来源；它错了，界面上那句警示就会撒谎，而且撒得很像真的。
import { describe, it, expect } from 'vitest';
import { countRunningTasks, isRunningTask } from '@/lib/project/projectDeletion';
import type { Sandbox, SandboxStatus } from '@/types/domain';

function task(id: string, projectId: string, status: SandboxStatus): Sandbox {
  return {
    id,
    projectId,
    name: id,
    status,
    waitingInput: status === 'waiting-input',
    lastActiveAt: 0,
  };
}

describe('isRunningTask · 六个状态逐个有归宿', () => {
  /**
   * ⭐ 三值全覆盖式断言：`SandboxStatus` 的六个取值逐个断言，后端/领域层加第七个值时
   * 这份表先红——而不是让新状态悄悄落进"不算运行中"那一边。
   */
  it.each<[SandboxStatus, boolean]>([
    ['preparing', true],
    ['running', true],
    ['waiting-input', true],
    ['paused', false],
    ['error', false],
    ['stopped', false],
  ])('%s → %s', (status, expected) => {
    expect(isRunningTask(status)).toBe(expected);
  });
});

describe('countRunningTasks', () => {
  const tasks = [
    task('a', 'p1', 'running'),
    task('b', 'p1', 'waiting-input'),
    task('c', 'p1', 'stopped'),
    task('d', 'p2', 'running'),
  ];

  it('只数本项目的、只数在跑的', () => {
    expect(countRunningTasks(tasks, 'p1')).toBe(2);
  });

  /** 跨项目串台是这条警示最坏的错法：会拿别人的任务数吓住要删空项目的人。 */
  it('不把别的项目的任务算进来', () => {
    expect(countRunningTasks(tasks, 'p2')).toBe(1);
  });

  it('全停了 → 0（而不是"未知"）', () => {
    expect(countRunningTasks([task('c', 'p1', 'stopped')], 'p1')).toBe(0);
  });

  it('没有项目 ⇒ 0', () => {
    expect(countRunningTasks(tasks, null)).toBe(0);
  });
});
