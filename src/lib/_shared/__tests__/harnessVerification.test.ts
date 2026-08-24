import { describe, it, expect, vi } from 'vitest';
import { selectProjectTaskTree, countWaitingInput } from '@/lib/project/selectProjectTaskTree';
import { WriteBatcher } from '@/lib/_shared/writeBatcher';
import type { Project, Sandbox } from '@/types/domain';

// 单测门禁「验证单测」：用既有纯函数做有意义的最小真实断言，证明 vitest 门禁确实在执行代码路径。
describe('harness verification（单测门禁真实执行证明）', () => {
  it('selectProjectTaskTree 把两个项目的任务正确归组并排序', () => {
    const projects: Project[] = [
      { id: 'p1', name: '项目一' },
      { id: 'p2', name: '项目二' },
    ];
    const tasks: Sandbox[] = [
      {
        id: 'a',
        projectId: 'p1',
        name: 'A',
        status: 'running',
        waitingInput: false,
        lastActiveAt: 1,
      },
      {
        id: 'b',
        projectId: 'p1',
        name: 'B',
        status: 'running',
        waitingInput: true,
        lastActiveAt: 9,
      },
      {
        id: 'c',
        projectId: 'p2',
        name: 'C',
        status: 'paused',
        waitingInput: false,
        lastActiveAt: 5,
      },
    ];

    const groups = selectProjectTaskTree(projects, tasks, {}, 'p2');

    // 当前项目置顶
    expect(groups[0]?.projectId).toBe('p2');
    // p1 组内按 lastActiveAt 倒序（B 在 A 前）
    const p1 = groups.find((g) => g.projectId === 'p1');
    expect(p1?.tasks.map((t) => t.id)).toEqual(['b', 'a']);
    // 跨全部项目的等待输入计数 = 1（只有 b）
    expect(countWaitingInput(tasks)).toBe(1);
  });

  it('WriteBatcher 在下一帧把多次 push 合并成一次 write', () => {
    const write = vi.fn();
    // 受控调度器：tick() 手动触发"下一帧"（在函数作用域内调用，避免闭包变量被收窄）。
    function makeScheduler() {
      let cb: (() => void) | null = null;
      return {
        schedule: (fn: () => void): number => {
          cb = fn;
          return 1;
        },
        cancel: (): void => {
          cb = null;
        },
        tick: (): void => {
          const fn = cb;
          cb = null;
          fn?.();
        },
      };
    }
    const s = makeScheduler();
    const batcher = new WriteBatcher({ write, schedule: s.schedule, cancel: s.cancel });

    batcher.push('foo');
    batcher.push('bar');
    expect(write).not.toHaveBeenCalled(); // 尚未到帧
    s.tick();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('foobar');
  });
});
