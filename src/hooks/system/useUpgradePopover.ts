import { useCallback, useEffect, useRef, useState } from 'react';

export function useUpgradePopover(visible: boolean) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const focusOwned = useRef(false);
  useEffect(() => {
    const trackFocus = () => {
      const active = document.activeElement;
      focusOwned.current =
        active !== null &&
        (active === triggerRef.current || contentRef.current?.contains(active) === true);
    };
    document.addEventListener('focusin', trackFocus);
    return () => {
      document.removeEventListener('focusin', trackFocus);
    };
  }, []);
  useEffect(() => {
    if (visible) return;
    setOpen(false);
    if (focusOwned.current) {
      const fallback =
        document.querySelector<HTMLButtonElement>(
          'header [data-testid="new-task-entry"]:not(:disabled)',
        ) ?? document.querySelector<HTMLAnchorElement>('a[href="/settings/system"]');
      fallback?.focus({ preventScroll: true });
      focusOwned.current = false;
    }
  }, [visible]);
  const onCloseAutoFocus = useCallback(
    (event: Event) => {
      const active = document.activeElement;
      if (
        !visible ||
        !focusOwned.current ||
        (active !== null &&
          active !== document.body &&
          active !== triggerRef.current &&
          contentRef.current?.contains(active) !== true)
      )
        event.preventDefault();
    },
    [visible],
  );
  return { open, setOpen, triggerRef, contentRef, onCloseAutoFocus };
}
