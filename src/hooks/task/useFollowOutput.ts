// 流式输出的「跟随底部」（副作用归 hook 层：views/ 禁 useEffect/useLayoutEffect，07 §3 规则 2）。
//
// 产品口径：用户盯一个可能跑 4 小时的任务，新输出必须自己滚进视口；
// 但**一旦用户主动往上翻**（去看前面某条错误），就必须停住——把人拽回底部比不自动滚更糟。
// 所以只有"贴近底部"时才跟随，脱离后给一个显式的「回到底部」按钮把控制权还回去。
import { useCallback, useEffect, useRef, useState } from 'react';

/** 距底多少像素之内算"还在底部"（一行的高度量级，容忍亚像素与惯性滚动的零头）。 */
const NEAR_BOTTOM_PX = 24;

export interface FollowOutputApi {
  /** 挂到滚动容器上。 */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** 挂到滚动容器的 onScroll 上（判断用户是否已脱离底部）。 */
  onScroll: () => void;
  /** false = 用户已往上翻，此时不再自动滚，UI 应给「回到底部」入口。 */
  following: boolean;
  /** 显式回到底部并恢复跟随。 */
  jumpToBottom: () => void;
}

/**
 * @param revision 内容版本号（喂 `items.length` 即可）：变化即尝试跟随一次。
 */
export function useFollowOutput(revision: number): FollowOutputApi {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [following, setFollowing] = useState(true);

  const onScroll = useCallback((): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    // 用"距底距离"而不是"滚动方向"：方向判定会被程序化滚动自己触发的 scroll 事件带偏。
    setFollowing(distance <= NEAR_BOTTOM_PX);
  }, []);

  const jumpToBottom = useCallback((): void => {
    const el = scrollRef.current;
    setFollowing(true);
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (!following) return;
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
  }, [revision, following]);

  return { scrollRef, onScroll, following, jumpToBottom };
}
