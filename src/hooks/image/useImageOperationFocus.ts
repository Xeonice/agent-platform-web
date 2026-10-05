import { useEffect, useRef } from 'react';

/** 异步按钮短暂disabled结束后仍回到发起按钮；被结果卸载的按钮不抢焦点。 */
export function useImageOperationFocus(validating: boolean, saving: boolean) {
  const validateRef = useRef<HTMLButtonElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const previous = useRef({ validating: false, saving: false });
  useEffect(() => {
    const finished =
      previous.current.validating && !validating
        ? validateRef.current
        : previous.current.saving && !saving
          ? saveRef.current
          : null;
    if (finished !== null && document.contains(finished)) finished.focus();
    previous.current = { validating, saving };
  }, [validating, saving]);
  return { validateRef, saveRef };
}
