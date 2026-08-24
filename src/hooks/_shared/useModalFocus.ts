// 弹层的焦点管理（副作用归 hook 层：views/ 禁 useEffect，07 §3 规则 2）。
//
// ★ 为什么需要它：弹层打开时焦点**不会自动进去**，仍停在打开它的那个元素上。
// 在这个产品里那通常是**正在跑的终端**——于是用户在弹窗里敲的字进了另一个 agent 的 shell，
// 而弹窗的输入框一个字都收不到。实测复现过：打开任务终端 → 点 [＋ 新任务] → 打字，
// `document.activeElement` 是 `.xterm-helper-textarea`，弹窗的 `#initial-prompt` 仍为空。
//
// 「新建项目」表单碰巧有 `autoFocus` 所以没事，「新建任务」没有 —— 两个弹窗在焦点行为上
// 并不对称，而"形态对称"正是这一轮的立论。
import { useEffect, useRef } from 'react';

/** 弹层内可获得焦点的元素（顺序即 DOM 顺序）。 */
function focusables(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * `active` 为真时：把焦点移进 `ref` 指向的弹层，并在其中做 Tab 循环；关闭时还原到
 * 打开前那个元素。
 *
 * ⚠️ 焦点**优先给第一个输入控件**而不是标题栏的 [✕]：弹窗打开就是为了让人填东西，
 * 把焦点丢在关闭按钮上，第一次 Tab 才进输入框，且回车会直接关掉弹窗。
 */
export function useModalFocus(active: boolean, ref: React.RefObject<HTMLElement | null>): void {
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;

    const active0 = document.activeElement;
    restoreTo.current = active0 instanceof HTMLElement ? active0 : null;
    const items = focusables(root);
    // 优先第一个非「关闭」控件；退而求其次给弹层自身（它带 tabIndex={-1}）。
    const preferred = items.find((el) => el.getAttribute('data-modal-close') === null) ?? items[0];
    (preferred ?? root).focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const list = focusables(root);
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      // 焦点已经跑到弹层外（浏览器地址栏回来、或程序化 focus）⇒ 拉回来。
      if (!root.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    // 捕获阶段：与 useEscapeKey 同理，终端会吞掉冒泡中的键。
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      // 还原焦点。元素可能已经不在文档里（弹窗关闭时整块被卸载）⇒ 静默跳过。
      const back = restoreTo.current;
      if (back && document.contains(back)) back.focus();
    };
  }, [active, ref]);
}
