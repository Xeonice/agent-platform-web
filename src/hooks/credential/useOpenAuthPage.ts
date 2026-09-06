import { useCallback, useState } from 'react';
import { browserOpenAuthPageDeps, openAuthPage } from '@/lib/credential/openAuthPage';

/**
 * [打开授权页] 的状态与动作（F07 §6.2a）。
 *
 * ⚠️ **为什么是 hook 而不是写在 container 里**：`boundaries` 只允许 container 依赖
 * view/hook/type/store/component —— `lib` 要经 hook 进来。这条规则在这里恰好也是对的：
 * 「开了没有 / 复制了没有」是两个会被界面读到的状态，它们本来就该有个 hook 装着。
 */
export interface UseOpenAuthPageResult {
  /** 弹窗被浏览器拦了 ⇒ 界面要显形（⛔ 不许装作开了）。 */
  popupBlocked: boolean;
  /** 设备码已进剪贴板 ⇒ 提示一句「已复制」，用户才知道可以直接粘贴。 */
  codeCopied: boolean;
  /**
   * ⚠️ **必须直接挂在 `onClick` 上。** 它内部第一句是同步的 `window.open`；
   * 调用方在它之前 `await` 任何东西，浏览器就会判定为非用户手势直接拦掉。
   */
  open: (url: string, userCode: string) => void;
  /** 换了一张挑战（[重新获取]）时把上一次的结论清掉 —— 否则旧的「被拦了」会赖在界面上。 */
  reset: () => void;
}

export function useOpenAuthPage(): UseOpenAuthPageResult {
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  const open = useCallback((url: string, userCode: string) => {
    // ⛔ 这里不 await：`openAuthPage` 同步开标签页，剪贴板那一下才是异步的。
    void openAuthPage(url, userCode, browserOpenAuthPageDeps()).then((r) => {
      setPopupBlocked(!r.opened);
      setCodeCopied(r.copied);
    });
  }, []);

  const reset = useCallback(() => {
    setPopupBlocked(false);
    setCodeCopied(false);
  }, []);

  return { popupBlocked, codeCopied, open, reset };
}
