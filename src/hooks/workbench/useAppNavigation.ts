import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/stores';

/** Preserve the opener across the command palette and any dialog opened by it. */
export function useAppNavigation() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const lastOutsideFocus = useRef<HTMLElement | null>(null);
  const currentModal = useAppStore((s) => s.currentModal);
  const accessLocked = useAppStore((s) => s.accessLocked);
  const previousModal = useRef(currentModal);
  const pendingRestore = useRef(false);
  const restoreFocus = useCallback(() => {
    if (useAppStore.getState().accessLocked) return;
    const target = opener.current?.isConnected
      ? opener.current
      : document.querySelector<HTMLElement>('[data-command-trigger]');
    target?.focus();
  }, []);
  const openPalette = useCallback(() => {
    if (useAppStore.getState().accessLocked || useAppStore.getState().currentModal !== null) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    pendingRestore.current = false;
    setPaletteOpen(true);
  }, []);
  const openShortcuts = useCallback(() => {
    if (useAppStore.getState().accessLocked || useAppStore.getState().currentModal !== null) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setShortcutsOpen(true);
  }, []);
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
  }, []);
  const deferFocusRestore = useCallback(() => {
    pendingRestore.current = true;
  }, []);
  const onCloseAutoFocus = useCallback(
    (event: Event) => {
      event.preventDefault();
      if (!pendingRestore.current) restoreFocus();
    },
    [restoreFocus],
  );
  useEffect(() => {
    if (!accessLocked) return;
    pendingRestore.current = false;
    setPaletteOpen(false);
    setShortcutsOpen(false);
  }, [accessLocked]);
  useEffect(() => {
    if (currentModal !== null && previousModal.current === null && !pendingRestore.current) {
      opener.current = lastOutsideFocus.current;
    }
    if (
      currentModal === null &&
      (previousModal.current !== null || pendingRestore.current) &&
      !paletteOpen
    ) {
      pendingRestore.current = false;
      restoreFocus();
    }
    previousModal.current = currentModal;
  }, [currentModal, paletteOpen, restoreFocus]);
  useEffect(() => {
    const captureFocus = (event: FocusEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        !target.closest('[role="dialog"], [role="menu"], [role="listbox"]')
      )
        lastOutsideFocus.current = target;
    };
    document.addEventListener('focusin', captureFocus);
    return () => {
      document.removeEventListener('focusin', captureFocus);
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (useAppStore.getState().accessLocked) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        useAppStore.getState().toggleSidebar();
      }
      const target = event.target;
      const editing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
          target.closest('.xterm'));
      if (
        event.key === '?' &&
        !editing &&
        !paletteOpen &&
        useAppStore.getState().currentModal === null
      ) {
        event.preventDefault();
        openShortcuts();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [paletteOpen, closePalette, openPalette, openShortcuts]);
  return {
    paletteOpen,
    shortcutsOpen,
    openPalette,
    openShortcuts,
    closePalette,
    closeShortcuts: () => {
      setShortcutsOpen(false);
    },
    onCloseAutoFocus,
    deferFocusRestore,
  };
}
