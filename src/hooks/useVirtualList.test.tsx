// 窗口计算的直测（F4）。容器级用例证明"虚拟化在真实面板里没改坏东西"，这里证明**算得对**：
// 省掉的高度必须一格不差地还给占位，否则滚动条长度与位置会一起错，
// 而那种错在长任务面板里的表现是"拖到底了还有内容没显示"——比不虚拟化更糟。
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVirtualList } from '@/hooks/useVirtualList';

const ESTIMATE = 20;
const OVERSCAN = 400;

/** 造一个可读写几何属性的滚动容器（jsdom 没有布局，全靠手动安装）。 */
function makeScrollHost(clientHeight: number): {
  ref: { current: HTMLElement | null };
  setScrollTop: (v: number) => void;
  /** 往容器里塞真实的行元素，并给它们安上 offsetHeight（模拟浏览器量出来的高度）。 */
  putRows: (heights: Record<string, number>) => void;
} {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  let scrollTop = 0;
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
  });
  document.body.appendChild(el);
  return {
    ref: { current: el },
    setScrollTop: (v) => {
      scrollTop = v;
    },
    putRows: (heights) => {
      el.replaceChildren();
      for (const [key, height] of Object.entries(heights)) {
        const li = document.createElement('li');
        li.dataset['vrow'] = key;
        Object.defineProperty(li, 'offsetHeight', { configurable: true, value: height });
        el.appendChild(li);
      }
    },
  };
}

function keysOf(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `k${String(i)}`);
}

describe('useVirtualList · 跟随态锚定末尾', () => {
  it('end 永远等于条目总数，start 只由视口高度决定（与总数无关）', () => {
    const host = makeScrollHost(400);
    const { result, rerender } = renderHook(
      ({ n }: { n: number }) =>
        useVirtualList({ keys: keysOf(n), scrollRef: host.ref, pinToEnd: true }),
      { initialProps: { n: 100 } },
    );

    const small = result.current.range;
    expect(small.end).toBe(100);
    expect(small.bottomPx).toBe(0);

    rerender({ n: 5000 });
    const large = result.current.range;
    expect(large.end).toBe(5000);
    // 渲染的行数不变（都是一屏 + overscan），只是起点往后挪了。
    expect(large.end - large.start).toBe(small.end - small.start);
    expect(large.end - large.start).toBeLessThanOrEqual((400 + OVERSCAN) / ESTIMATE + 1);
  });

  it('顶部占位 + 窗口内高度 = 完整列表高度（省掉的必须还回去）', () => {
    const host = makeScrollHost(400);
    const { result } = renderHook(() =>
      useVirtualList({ keys: keysOf(1000), scrollRef: host.ref, pinToEnd: true }),
    );
    const { start, end, topPx, bottomPx } = result.current.range;
    expect(topPx + (end - start) * ESTIMATE + bottomPx).toBe(1000 * ESTIMATE);
  });
});

describe('useVirtualList · 脱离跟随后按 scrollTop 算', () => {
  it('滚到中间 ⇒ 窗口跟着走，两端占位各自承接窗口外的高度', () => {
    const host = makeScrollHost(400);
    const { result } = renderHook(() =>
      useVirtualList({ keys: keysOf(1000), scrollRef: host.ref, pinToEnd: false }),
    );

    host.setScrollTop(10_000); // 第 500 行附近
    act(() => {
      result.current.onScroll();
    });

    const { start, end, topPx, bottomPx } = result.current.range;
    expect(start).toBeGreaterThan(400);
    expect(end).toBeLessThan(1000);
    expect(topPx).toBe(start * ESTIMATE);
    expect(topPx + (end - start) * ESTIMATE + bottomPx).toBe(1000 * ESTIMATE);
  });

  it('滚到最顶 ⇒ start 为 0、没有顶部占位（开头不该被一段空白顶下去）', () => {
    const host = makeScrollHost(400);
    const { result } = renderHook(() =>
      useVirtualList({ keys: keysOf(1000), scrollRef: host.ref, pinToEnd: false }),
    );
    host.setScrollTop(0);
    act(() => {
      result.current.onScroll();
    });
    expect(result.current.range.start).toBe(0);
    expect(result.current.range.topPx).toBe(0);
  });
});

describe('useVirtualList · 行高是量出来的', () => {
  it('量到的高度覆盖估计值（展开的折叠块比一行高得多，按估计排版会整片错位）', () => {
    const host = makeScrollHost(400);
    // 前三行分别是 200 / 20 / 20 —— 第一行相当于一个展开的工具块。
    host.putRows({ k0: 200, k1: 20, k2: 20 });
    const { result, rerender } = renderHook(() =>
      useVirtualList({ keys: keysOf(500), scrollRef: host.ref, pinToEnd: false }),
    );
    rerender();

    host.setScrollTop(100); // 落在第一行（200px）内部
    act(() => {
      result.current.onScroll();
    });

    // 按估计值算，scrollTop=100 已经越过 5 行；按真实高度算才仍在第 0 行。
    expect(result.current.range.start).toBe(0);
    // 完整高度也跟着变：3 行量到了真实值，其余仍是估计。
    const { start, end, topPx, bottomPx } = result.current.range;
    const total = 200 + 20 + 20 + (500 - 3) * ESTIMATE;
    const inWindow = [200, 20, 20]
      .concat(Array.from({ length: 500 - 3 }, () => ESTIMATE))
      .slice(start, end)
      .reduce((a, b) => a + b, 0);
    expect(topPx + inWindow + bottomPx).toBe(total);
  });

  it('量到 0（jsdom 无布局 / 尚未 paint）不当成"这一行没有高度"，仍用估计值', () => {
    const host = makeScrollHost(400);
    host.putRows({ k0: 0, k1: 0 });
    const { result, rerender } = renderHook(() =>
      useVirtualList({ keys: keysOf(100), scrollRef: host.ref, pinToEnd: true }),
    );
    rerender();
    const { start, end, topPx, bottomPx } = result.current.range;
    expect(topPx + (end - start) * ESTIMATE + bottomPx).toBe(100 * ESTIMATE);
  });
});

describe('useVirtualList · 边界', () => {
  it('空列表 ⇒ 空窗口、零占位（别渲染两个撑高的空 li）', () => {
    const host = makeScrollHost(400);
    const { result } = renderHook(() =>
      useVirtualList({ keys: [], scrollRef: host.ref, pinToEnd: true }),
    );
    expect(result.current.range).toEqual({ start: 0, end: 0, topPx: 0, bottomPx: 0 });
  });

  it('容器还没挂上（ref 为 null）不炸，按兜底屏高给一个窗口', () => {
    const ref: { current: HTMLElement | null } = { current: null };
    const { result } = renderHook(() =>
      useVirtualList({ keys: keysOf(1000), scrollRef: ref, pinToEnd: true }),
    );
    expect(result.current.range.end).toBe(1000);
    expect(result.current.range.start).toBeGreaterThan(0);
  });
});
