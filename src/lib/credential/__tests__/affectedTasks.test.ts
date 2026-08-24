import { describe, it, expect } from 'vitest';
import { affectedRunningTasks } from '@/lib/credential/affectedTasks';
import type { AffectedTaskInput } from '@/types/runtimeCredential';

function task(id: string, runtime: string, status: string): AffectedTaskInput {
  return { id, name: `任务 ${id}`, runtime, status };
}

describe('affectedRunningTasks（F21-3 §7.1）', () => {
  it('按 runtime 过滤运行中 Task', () => {
    const tasks = [
      task('1', 'codex', 'running'),
      task('2', 'codex', 'stopped'),
      task('3', 'claude-code', 'running'),
      task('4', 'codex', 'waiting_input'),
    ];
    const result = affectedRunningTasks(tasks, 'codex');
    expect(result.total).toBe(2);
    expect(result.items.map((i) => i.id)).toEqual(['1', '4']);
    expect(result.restCount).toBe(0);
  });

  it('>10 条 → 返回前 10 + restCount', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task(String(i), 'codex', 'running'));
    const result = affectedRunningTasks(tasks, 'codex');
    expect(result.items).toHaveLength(10);
    expect(result.restCount).toBe(2);
    expect(result.total).toBe(12);
  });

  it('无运行中 Task → 空', () => {
    expect(affectedRunningTasks([task('1', 'codex', 'stopped')], 'codex').total).toBe(0);
  });
});
