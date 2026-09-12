// `useDebouncedValue`：P21-1 §6 搜索防抖 200ms。
//
// ⚠️ 硬要求（用户裁决）：必须证明"真的在防抖"——假定时器推进时间，断言变化后
// 200ms **前**没有生效、200ms **后**才生效。⛔ 不是只断言"最终值对了"（那样把
// `useDebouncedValue` 整个删掉、容器直接用 `searchQuery` 本身，最终过滤结果一样对，
// 但防抖已经名存实亡——本文件的每一条用例都会在那种改法下变红）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from '@/hooks/project/useDebouncedValue';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedValue · 200ms 防抖', () => {
  /**
   * ⭐ 边界值钉子：199ms 时还没变，刚好 200ms 才变——不是"随便一个数早晚会变"。
   * MUTATION：把实现里的 `delayMs` 参数忽略、写死用别的毫秒数 ⇒ 199ms 断言或
   * 200ms 断言会有一条读到相反的值。
   */
  it('199ms 时仍是旧值，满 200ms 那一刻才更新为新值', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: '' },
    });
    expect(result.current).toBe('');

    rerender({ v: 'x' });
    act(() => {
      vi.advanceTimersByTime(199);
    });
    // ⭐ 关键断言：200ms 前没有发生——这正是"防抖"这个词本身要求的行为。
    expect(result.current).toBe('');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    // ⭐ 关键断言：满 200ms 之后发生。
    expect(result.current).toBe('x');
  });

  /**
   * ⭐ 「防抖」而非「节流」的判据：连续多次变化，计时器要被后一次重置，只有
   * **最后一次变化之后** 200ms 才生效一次；不是"每次变化各自算 200ms、依次生效"。
   * MUTATION：如果实现漏了 `useEffect` 的清理函数（不 `clearTimeout` 旧计时器），
   * 't1' 会在自己那次的 200ms 时先生效一次 ⇒ 中间那条"仍是旧值"的断言会红。
   */
  it('200ms 内连续多次变化，只在最后一次之后 200ms 生效一次（防抖不是节流）', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: '' },
    });

    rerender({ v: 't1' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ v: 't2' }); // 100ms 时又变了一次：计时器应从这里重新计 200ms。

    act(() => {
      vi.advanceTimersByTime(100);
    });
    // 从 't1' 算已经过了 200ms，但从重置计时器的 't2' 算只过了 100ms——仍应是旧值。
    expect(result.current).toBe('');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    // 't2' 之后满 200ms：生效，且直接是最后一次的值（'t2'），从未经过 't1'。
    expect(result.current).toBe('t2');
  });

  it('卸载时清理未触发的计时器（不泄漏、不在卸载后仍尝试 setState）', () => {
    const { rerender, unmount } = renderHook(({ v }) => useDebouncedValue(v, 200), {
      initialProps: { v: '' },
    });
    rerender({ v: 'y' });
    unmount();
    // 卸载后推进时间不应抛错（React 18 严格模式下对已卸载组件 setState 会警告/报错）。
    expect(() => {
      act(() => {
        vi.advanceTimersByTime(300);
      });
    }).not.toThrow();
  });
});
