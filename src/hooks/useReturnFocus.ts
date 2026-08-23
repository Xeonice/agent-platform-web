// 破坏性操作确认环节的焦点归还（副作用归 hook 层：views/ 禁 useEffect，07 §3 规则 2）。
//
// 为什么需要它：点「终止任务」后原按钮**被卸载**（换成确认条），`document.activeElement`
// 当场掉回 `<body>`。对键盘用户来说，Tab 焦点从此丢在文档开头；取消之后也回不来。
// 一个不可逆操作的确认环节，对键盘/读屏用户等于不存在。
import { useEffect, useRef } from 'react';

/**
 * `active` 由 true 变回 false 时（取消 / Esc / 确认后回到常态），把焦点还给 `ref` 指的元素。
 *
 * 只在**跃迁**上动焦点，不在每次渲染上抢：否则用户切走去点别处会被拽回来。
 */
export function useReturnFocus(active: boolean, ref: React.RefObject<HTMLElement | null>): void {
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active) ref.current?.focus();
    wasActive.current = active;
  }, [active, ref]);
}
