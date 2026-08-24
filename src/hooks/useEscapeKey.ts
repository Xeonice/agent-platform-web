// 弹层的 Esc 关闭（副作用归 hook 层：views/ 禁 useEffect，07 §3 规则 2）。
//
// 为什么不做成 view 里的 `onKeyDown`：那只在**焦点已经落在弹层内部**时才收得到键。
// 弹层刚打开、用户还没 Tab 进去时，keydown 的 target 是 `<body>`，事件根本不经过
// 弹层的 DOM 子树 —— 于是 Esc 时灵时不灵，而这正是最难在测试里稳定复现的那种坏法。
// 挂 window 才是"Esc 一定能关"的实现（与 `app/settings/layout.tsx` 的 Esc 回工作台同一套）。
import { useEffect } from 'react';

/**
 * `active` 为真时监听 Esc；关闭后自动摘除监听（不留全局键位）。
 * `onEscape` 由调用方保证稳定（container 里通常是 `useCallback` 或直接写内联——
 * 内联也无妨：effect 依赖它，重挂一次监听的代价可以忽略，而漏掉最新闭包才是 bug）。
 */
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [active, onEscape]);
}
