import { useEffect } from 'react';
import { useAppStore } from '@/stores';
import type { RetainedVolumeRow } from '@/types/retainedVolume';
export function projectMenuCloseFocus(projectId: string) {
  return (event: Event): void => {
    event.preventDefault();
    document
      .querySelector<HTMLButtonElement>(`[data-project-menu-trigger="${projectId}"]`)
      ?.focus();
  };
}
export function revealProjectTasks(projectId: string): void {
  const state = useAppStore.getState();
  state.setTaskStatusFilter('all');
  state.setTaskSearch('');
  state.expandProject(projectId);
  state.setSelectedProjectId(projectId);
  requestAnimationFrame(() => {
    const target = document.querySelector(`[data-project-group="${projectId}"]`);
    if (target && typeof target.scrollIntoView === 'function')
      target.scrollIntoView({ block: 'nearest' });
  });
}
export function focusRetainedDelete(id: string | null): void {
  if (id === null) return;
  requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>(`[data-retained-delete="${id}"]`)?.focus();
  });
}
export function revealLaunchAuthPanel(): void {
  requestAnimationFrame(() => {
    const target = document.getElementById('launch-auth-panel');
    if (target && typeof target.scrollIntoView === 'function')
      target.scrollIntoView({ block: 'nearest' });
  });
}
export function useRetainedVolumeFocus(rows: RetainedVolumeRow[], sandboxId: string | null): void {
  useEffect(() => {
    const row = rows.find((item) => item.sandboxId === sandboxId);
    if (row) {
      const target = document.getElementById(`retained-${row.id}`);
      if (target && typeof target.scrollIntoView === 'function')
        target.scrollIntoView({ block: 'nearest' });
    }
  }, [rows, sandboxId]);
}
export function useWelcomeFocus(active: boolean): void {
  useEffect(() => {
    if (active) document.getElementById('workbench-welcome-title')?.focus();
  }, [active]);
}

export function focusDestructiveCancel(event: Event): void {
  event.preventDefault();
  // Pointer menu selection finishes its focus scope after the dialog mounts.
  // Hand off after that scope is removed, so its mouse-up cannot leave focus on body.
  requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>('[data-dialog-cancel]')?.focus();
  });
}

/** A menu handing focus to a dialog must not restore its trigger after that dialog opens. */
export function preserveProjectDialogFocus(event: Event): void {
  if (useAppStore.getState().currentModal !== null) event.preventDefault();
}
