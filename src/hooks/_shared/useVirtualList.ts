// 输出列表的**窗口化**（虚拟滚动）。副作用（量高度、读滚动位）归 hook 层（07 §3 规则 2）。
//
// 为什么需要它（S6 实测数据）：
//  · 20000 条正文帧纯 reducer **274ms** —— `[...items]` 每帧 O(n) ⇒ 总体 O(n²)（那一半由环形上限兜着）；
//  · 5000 条时 DOM **10006 个节点**，再来一条事件重渲 **34ms**。
// `MAX_STREAM_ITEMS = 5000` 只保证不 OOM，不保证不卡：一个跑 4 小时的任务，用户每收一行都要付
// 一次 5000 条的 reconcile。窗口化把"每帧的成本"从**列表长度**解耦到**视口高度**。
//
// 三条设计选择，每条都是为了和既有行为共存（S6 那几条不许改坏的语义）：
//
//  ① **跟随底部时锚定末尾，而不是锚定 scrollTop**（`pinToEnd`）。
//     浏览器对程序化 `scrollTop = scrollHeight` 的 `scroll` 事件是**异步**投递的 ⇒ 若窗口只由
//     scrollTop 推导，每追加一行都会有一帧渲染的是"上一次的窗口"，流式输出下就是持续抖动。
//     跟随态的语义本来就是"看末尾"，直接按末尾算，既没有这一帧的滞后也更省事。
//
//  ② **行高是量出来的，不是假设的**（按条目 id 记账）。工具调用折叠块展开后能有十几行，
//     固定行高会让滚动条长度和位置一起错。量不到（尚未渲染 / jsdom 没有布局）就退回估计值。
//
//  ③ **窗口之外用两个占位 `<li>` 撑高**，所以 `scrollHeight` 仍然等于完整列表的高度 ——
//     `useFollowOutput` 的 `scrollTop = scrollHeight` 和「回到底部」都不需要知道虚拟化的存在。
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { VirtualWindow } from '@/types/taskStream';

/** 单行高度的估计值（等宽 12px 字体一行 + 行间距的量级）。仅用于**尚未量到**的行。 */
const DEFAULT_ESTIMATE_ROW_PX = 20;

/**
 * 视口高度还没量到时的兜底（首帧、或容器被藏起来时 `clientHeight` 为 0）。
 *
 * ⚠️ 不能退化成"量不到就全量渲染"：那会让首帧把几千条一次性铺进 DOM ——
 * 正是本 hook 要消灭的那一帧。给一个保守的屏高即可，量到之后立刻纠正。
 */
const DEFAULT_FALLBACK_VIEWPORT_PX = 480;

/** 视口上下各多渲染这么多像素，滚动时才不会露白。 */
const DEFAULT_OVERSCAN_PX = 400;

export interface UseVirtualListArgs {
  /** 每个条目的稳定 key（顺序 = 渲染顺序）。行高按它记账，环形丢头也不会张冠李戴。 */
  keys: readonly string[];
  /** 滚动容器（与 useFollowOutput 共用同一个 ref）。 */
  scrollRef: React.RefObject<HTMLElement | null>;
  /** true = 正在跟随底部 ⇒ 窗口锚定末尾（见 ①）。 */
  pinToEnd: boolean;
  estimateRowPx?: number;
  fallbackViewportPx?: number;
  overscanPx?: number;
}

export interface VirtualListApi {
  /** 当前该渲染的窗口 + 两端占位高度。 */
  range: VirtualWindow;
  /** 挂到滚动容器的 onScroll 上（与 useFollowOutput 的同名回调**一起**挂）。 */
  onScroll: () => void;
}

function computeWindow(
  sizes: readonly number[],
  viewportPx: number,
  scrollTop: number,
  pinToEnd: boolean,
  overscanPx: number,
): VirtualWindow {
  const count = sizes.length;
  if (count === 0) return { start: 0, end: 0, topPx: 0, bottomPx: 0 };

  const offsets: number[] = new Array<number>(count);
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    offsets[i] = total;
    total += sizes[i] ?? 0;
  }

  if (pinToEnd) {
    // 从末尾往回收，直到攒够一屏 + overscan。至少留一行，空窗口没有意义。
    const budget = viewportPx + overscanPx;
    let start = count;
    let used = 0;
    while (start > 0 && used < budget) {
      start -= 1;
      used += sizes[start] ?? 0;
    }
    return { start, end: count, topPx: offsets[start] ?? 0, bottomPx: 0 };
  }

  const top = Math.max(0, scrollTop - overscanPx);
  const bottom = scrollTop + viewportPx + overscanPx;

  let start = 0;
  while (start + 1 < count && (offsets[start + 1] ?? 0) <= top) start += 1;

  let end = start + 1;
  while (end < count && (offsets[end] ?? 0) < bottom) end += 1;

  return {
    start,
    end,
    topPx: offsets[start] ?? 0,
    bottomPx: total - (offsets[end - 1] ?? 0) - (sizes[end - 1] ?? 0),
  };
}

export function useVirtualList({
  keys,
  scrollRef,
  pinToEnd,
  estimateRowPx = DEFAULT_ESTIMATE_ROW_PX,
  fallbackViewportPx = DEFAULT_FALLBACK_VIEWPORT_PX,
  overscanPx = DEFAULT_OVERSCAN_PX,
}: UseVirtualListArgs): VirtualListApi {
  const [scrollTop, setScrollTop] = useState(0);
  /** 0 = 还没量到（首帧 / 容器不可见）⇒ 用兜底屏高。 */
  const [viewportPx, setViewportPx] = useState(0);
  /** 量到的行高变化时 +1，驱动窗口重算（Map 是可变的，不能进 deps）。 */
  const [measureTick, setMeasureTick] = useState(0);
  const heightsRef = useRef(new Map<string, number>());

  /**
   * 量一遍：视口高度 + 当前渲染出来的每一行的真实高度。
   * ⚠️ 只在**确实变了**时才 setState —— 否则它会把自己变成一个渲染死循环。
   */
  const measure = useCallback((): void => {
    const el = scrollRef.current;
    if (el === null) return;
    setViewportPx((prev) => (prev === el.clientHeight ? prev : el.clientHeight));

    let changed = false;
    for (const row of el.querySelectorAll<HTMLElement>('[data-vrow]')) {
      const key = row.dataset['vrow'];
      const height = row.offsetHeight;
      // 量到 0 = 没有布局（jsdom / 尚未 paint）⇒ 保留估计值，不要把 0 记成"这一行没有高度"。
      if (key === undefined || height <= 0) continue;
      if (heightsRef.current.get(key) !== height) {
        heightsRef.current.set(key, height);
        changed = true;
      }
    }
    if (changed) setMeasureTick((t) => t + 1);
  }, [scrollRef]);

  const onScroll = useCallback((): void => {
    const el = scrollRef.current;
    if (el === null) return;
    setScrollTop(el.scrollTop);
    setViewportPx(el.clientHeight);
  }, [scrollRef]);

  const range = useMemo(() => {
    const sizes = keys.map((k) => heightsRef.current.get(k) ?? estimateRowPx);
    return computeWindow(
      sizes,
      viewportPx > 0 ? viewportPx : fallbackViewportPx,
      scrollTop,
      pinToEnd,
      overscanPx,
    );
    // measureTick 是 heightsRef 内容变化的信号（Map 本身引用不变，进不了 deps）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    keys,
    viewportPx,
    scrollTop,
    pinToEnd,
    estimateRowPx,
    fallbackViewportPx,
    overscanPx,
    measureTick,
  ]);

  // 窗口或条目变化后重量一次（新进窗口的行还没被量过）。
  useLayoutEffect(() => {
    measure();
  }, [measure, keys, range]);

  /**
   * 内容高度的变化不一定经过本 hook 的渲染：折叠块的展开态住在**视图**自己的 state 里
   * （见 TaskOutputPane.view 的注释），它一变，容器根本不重渲，上面那个 effect 也就不会跑。
   * ResizeObserver 是唯一不依赖"谁重渲了"的观察手段。
   *
   * jsdom 没有 ResizeObserver、也没有布局 ⇒ 直接跳过；那边所有行高本来就是估计值。
   */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(el); // 视口高度变化（窗口 resize / 布局变化）
    const content = el.firstElementChild;
    if (content !== null) observer.observe(content); // 内容总高变化（折叠块展开/收起）
    return (): void => {
      observer.disconnect();
    };
    // range 进 deps：窗口一换，`firstElementChild` 可能是新的占位节点，要重新盯。
  }, [measure, scrollRef, range]);

  return { range, onScroll };
}
