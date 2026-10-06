import { useEffect, useRef } from 'react';
import { useAppStore } from '@/stores';
import { getSandbox } from '@/services/api/sandbox.service';
import { ApiErrorException } from '@/services/api/apiError';
export function selectWorkbenchTask(id: string, projectId: string, name?: string): void {
  const store = useAppStore.getState();
  store.setWorkbenchNotice(null);
  store.setSelectedProjectId(projectId);
  store.setSelectedSandboxId(id);
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    url.pathname = '/';
    url.searchParams.set('taskId', id);
    window.history.pushState(
      { ...window.history.state, workbenchTaskName: name },
      '',
      `${url.pathname}${url.search}`,
    );
  }
}
export function useWorkbenchRoute(): void {
  const generation = useRef(0);
  useEffect(() => {
    let disposed = false;
    const restore = async () => {
      const token = ++generation.current;
      const id = new URLSearchParams(window.location.search).get('taskId');
      if (id === null) return;
      try {
        const dto = await getSandbox(id);
        if (disposed || token !== generation.current) return;
        const store = useAppStore.getState();
        store.setSelectedProjectId(dto.projectId);
        store.setSelectedSandboxId(dto.id);
      } catch (error) {
        if (
          disposed ||
          token !== generation.current ||
          !(error instanceof ApiErrorException) ||
          error.httpStatus !== 404
        )
          return;
        const historyState: unknown = window.history.state;
        const name: unknown =
          historyState !== null && typeof historyState === 'object'
            ? Reflect.get(historyState, 'workbenchTaskName')
            : undefined;
        const store = useAppStore.getState();
        store.setSelectedProjectId(null);
        store.setSelectedSandboxId(null);
        store.setCurrentModal(null);
        store.setWorkbenchNotice({
          message:
            typeof name === 'string'
              ? `找不到任务「${name}」：可能已被销毁。`
              : '找不到这个任务：可能已被销毁。',
        });
        const url = new URL(window.location.href);
        url.searchParams.delete('taskId');
        url.searchParams.delete('project');
        url.searchParams.delete('new');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
      }
    };
    void restore();
    const pop = () => {
      if (!new URLSearchParams(window.location.search).has('taskId')) {
        const s = useAppStore.getState();
        s.setSelectedProjectId(null);
        s.setSelectedSandboxId(null);
      } else void restore();
    };
    window.addEventListener('popstate', pop);
    return () => {
      disposed = true;
      window.removeEventListener('popstate', pop);
    };
  }, []);
}
