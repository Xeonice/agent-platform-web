import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '@/stores';

/** Passive observation only. Never changes a form, terminal selection or IME composition. */
export function useUpgradeLeaveGuard() {
  const composing = useRef(false);
  const dirty = useRef(new Set<HTMLFormElement>());
  useEffect(() => {
    const onStart = () => {
      composing.current = true;
    };
    const onEnd = () => {
      composing.current = false;
    };
    const onInput = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const form = target.closest('form');
        if (form !== null && !form.hasAttribute('data-upgrade-authorization'))
          dirty.current.add(form);
      }
    };
    const onReset = (event: Event) => {
      if (event.target instanceof HTMLFormElement) dirty.current.delete(event.target);
    };
    document.addEventListener('compositionstart', onStart, true);
    document.addEventListener('compositionend', onEnd, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onInput, true);
    document.addEventListener('reset', onReset, true);
    return () => {
      document.removeEventListener('compositionstart', onStart, true);
      document.removeEventListener('compositionend', onEnd, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('change', onInput, true);
      document.removeEventListener('reset', onReset, true);
    };
  }, []);
  return useCallback((): 'allowed' | 'composing' | 'cancelled' => {
    if (composing.current) return 'composing';
    for (const form of dirty.current) if (!form.isConnected) dirty.current.delete(form);
    const terminalSelection = Array.from(useAppStore.getState().entries.values()).some(
      (entry) => entry.terminal.hasSelection?.() === true,
    );
    if (
      dirty.current.size > 0 ||
      terminalSelection ||
      (window.getSelection()?.toString().length ?? 0) > 0
    ) {
      if (!window.confirm('页面中有尚未提交的内容或选中的文本，仍要刷新吗？')) return 'cancelled';
    }
    return 'allowed';
  }, []);
}
