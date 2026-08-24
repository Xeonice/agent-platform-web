import { describe, it, expect, vi } from 'vitest';
import { WriteBatcher } from '@/lib/_shared/writeBatcher';

/** 受控调度器：手动触发"下一帧"。 */
function controlledScheduler() {
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
    get scheduled(): boolean {
      return cb !== null;
    },
  };
}

describe('WriteBatcher (08 §6.1)', () => {
  it('把多次 push 合并成下一帧一次 write', () => {
    const write = vi.fn();
    const s = controlledScheduler();
    const batcher = new WriteBatcher({ write, schedule: s.schedule, cancel: s.cancel });
    batcher.push('a');
    batcher.push('b');
    batcher.push('c');
    expect(write).not.toHaveBeenCalled();
    s.tick();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('abc');
  });

  it('达到单批上限立即 flush，不等下一帧', () => {
    const write = vi.fn();
    const s = controlledScheduler();
    const batcher = new WriteBatcher({
      write,
      schedule: s.schedule,
      cancel: s.cancel,
      maxBytes: 4,
    });
    batcher.push('abcd');
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('abcd');
    expect(s.scheduled).toBe(false);
  });

  it('flushAndCancel 先 flush 残留再取消 rAF', () => {
    const write = vi.fn();
    const s = controlledScheduler();
    const batcher = new WriteBatcher({ write, schedule: s.schedule, cancel: s.cancel });
    batcher.push('x');
    batcher.flushAndCancel();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('x');
    expect(s.scheduled).toBe(false);
  });
});
