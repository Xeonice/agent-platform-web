import { useEffect, useState } from 'react';
import { useAppStore } from '@/stores';
import { agentSessionIdOf } from '@/stores/createTerminalTabsSlice';
import { useInstanceIdentity } from '@/hooks/system/useInstanceUpgrade';
import { readTerminalBookmark, terminalBookmarkKey } from '@/lib/terminal/terminalBookmark';
import type { TerminalSessionKind } from '@/types/ws-protocol';
import { shellTabSeqOf } from '@/lib/terminal/terminalTabs';

/** Only a public identity is persisted; restore performs no task or terminal creation. */
export function useTerminalBookmark(
  sandboxId: string,
  activeSessionId: string,
  tabs: readonly {
    sessionId: string;
    terminalIdentity?: string;
    runtimeId?: string;
    kind: TerminalSessionKind;
  }[],
) {
  const identity = useInstanceIdentity();
  const key =
    identity === null || identity === undefined
      ? null
      : terminalBookmarkKey(identity.instanceId, identity.userScope, sandboxId);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    const store = useAppStore.getState();
    const changed = store.prepareTerminalScope(sandboxId, key);
    if (changed) store.setActiveSession(sandboxId, agentSessionIdOf(sandboxId));
    let bookmark = null;
    try {
      bookmark = readTerminalBookmark(localStorage.getItem(key));
    } catch {
      /* optional preference */
    }
    if (bookmark !== null) {
      const sessionId = store.restoreTerminalBookmark(sandboxId, bookmark);
      store.setActiveSession(sandboxId, sessionId);
      store.markTabActivated(sessionId);
    }
    setHydratedKey(key);
  }, [key, sandboxId]);
  useEffect(() => {
    if (key === null || hydratedKey !== key) return;
    const selected = tabs.find((tab) => tab.sessionId === activeSessionId);
    if (selected?.terminalIdentity === undefined) return;
    // Construct an explicit whitelist. Never serialize a tab/socket/store wholesale.
    const bookmark = {
      version: 1,
      terminalIdentity: selected.terminalIdentity,
      kind: selected.kind,
      ordinal: selected.kind === 'agent' ? 0 : shellTabSeqOf(selected.sessionId),
      ...(selected.runtimeId === undefined ? {} : { runtimeId: selected.runtimeId }),
    };
    try {
      localStorage.setItem(key, JSON.stringify(bookmark));
    } catch {
      /* in-memory tabs still work */
    }
  }, [key, hydratedKey, tabs, activeSessionId]);
  return { restorationReady: identity === undefined || (key !== null && hydratedKey === key) };
}
