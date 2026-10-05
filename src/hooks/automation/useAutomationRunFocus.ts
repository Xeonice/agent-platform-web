import { useEffect, useRef } from 'react';
import type { RunRow } from '@/types/automation';

/** Move focus once when opening the most recent counted failure from 查看原因. */
export function useAutomationRunFocus(rows: RunRow[], enabled: boolean) {
  const regionRef = useRef<HTMLElement>(null);
  const focused = useRef(false);
  const id = enabled ? rows.find((row) => row.outcome.countsTowardFailure)?.id : undefined;
  useEffect(() => {
    if (!enabled) {
      focused.current = false;
      return;
    }
    if (id === undefined || focused.current) return;
    const row = [...(regionRef.current?.querySelectorAll<HTMLElement>('[data-run-id]') ?? [])].find(
      (item) => item.dataset['runId'] === id,
    );
    const button = row?.querySelector<HTMLButtonElement>('[data-testid="run-toggle-detail"]');
    if (!button || !row) return;
    row.scrollIntoView({ block: 'start', behavior: 'smooth' });
    button.focus({ preventScroll: true });
    focused.current = true;
  }, [id, rows, enabled]);
  return regionRef;
}
