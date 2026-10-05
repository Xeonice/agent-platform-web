import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { API, deferred, project, sandbox } from './support/fixtures';
import { server } from './support/server';
import { mount } from './support/mount';
import { AppFrameContainer } from '@/containers/workbench/AppFrameContainer';
import { WorkbenchContainer } from '@/containers/workbench/WorkbenchContainer';
import { useAppStore } from '@/stores';
import { useSandboxRestore } from '@/hooks/sandbox/useSandboxRestore';
import { projectKeys } from '@/hooks/project/useProjects';
import type { ProjectDto } from '@/types/project';

const wire = vi.hoisted(() => ({
  connections: [] as { handlers: Map<string, (payload: unknown) => void> }[],
}));
// Terminal rendering is observed at its PTY boundary; this test isolates event/REST acceptance order.
vi.mock('@/containers/terminal/TerminalTabsContainer', () => ({
  TerminalTabsContainer: () => <output data-testid="accepted-terminal">交互终端已挂载</output>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
// Only socket.io itself is replaced: the production EventsSocket decoder, hook and AppFrame handlers run.
vi.mock('socket.io-client', () => ({
  io: () => {
    const connection = { handlers: new Map<string, (payload: unknown) => void>() };
    wire.connections.push(connection);
    return {
      on: (event: string, callback: (payload: unknown) => void) => {
        connection.handlers.set(event, callback);
      },
      disconnect: () => undefined,
    };
  },
}));
function RestoredTaskOutsideList() {
  useSandboxRestore('task-c', 'project-a');
  const status = useAppStore((state) => state.sandboxStatuses['task-c']?.status);
  return <output data-testid="restored-outside-list">{status}</output>;
}
describe('EVT · REST/events ordering and reconnect resynchronization', () => {
  it('AC-EVT-002: a REST response started before a newer event cannot overwrite it; reconnect performs a real fresh list read', async () => {
    const stale = deferred();
    const reads = vi.fn();
    let count = 0;
    server.use(
      http.get(`${API}/api/projects`, () => HttpResponse.json([project({ taskCount: 1 })])),
      http.get(`${API}/api/sandboxes`, async () => {
        reads();
        if (++count === 1) {
          await stale.promise;
          return HttpResponse.json([
            sandbox({ status: 'pending', hasRun: false, waitingInput: false }),
          ]);
        }
        return HttpResponse.json([sandbox({ status: 'stopped', waitingInput: false })]);
      }),
    );
    const mounted = mount(
      <AppFrameContainer>
        <WorkbenchContainer />
      </AppFrameContainer>,
    );
    await waitFor(() => {
      expect(reads).toHaveBeenCalledOnce();
    });
    const connection = wire.connections.at(-1);
    if (!connection) throw new Error('Production events connection missing');
    act(() => {
      connection.handlers.get('connect')?.(undefined);
      connection.handlers.get('event')?.({
        event: 'sandbox.status_changed',
        sandboxId: 'task-a',
        status: 'running',
      });
    });
    expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('running');
    act(stale.release);
    const tree = await screen.findByRole('navigation', { name: '项目分组任务树' });
    await within(tree).findByText('修复首页');
    expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('running');
    expect(within(tree).getByText('运行中')).toBeInTheDocument();
    expect(reads).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    act(() => {
      connection.handlers.get('disconnect')?.(undefined);
      vi.advanceTimersByTime(1000);
    });
    const reconnect = wire.connections.at(-1);
    expect(reconnect).not.toBe(connection);
    act(() => {
      reconnect?.handlers.get('connect')?.(undefined);
    });
    vi.useRealTimers();
    await waitFor(() => {
      expect(reads.mock.calls.length).toBeGreaterThan(1);
    });
    await within(tree).findByText('已停止');
    expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('stopped');
    mounted.unmount();
  });
  it('AC-EVT-002.1/002.2: reconnect refreshes projects, removes a destroyed list row and restores a newly selected task absent from the old list', async () => {
    let offline = false;
    const lists = vi.fn();
    const projects = vi.fn();
    const details = vi.fn();
    server.use(
      http.get(`${API}/api/projects`, () => {
        projects();
        return HttpResponse.json([project({ taskCount: offline ? 1 : 2 })]);
      }),
      http.get(`${API}/api/sandboxes`, () => {
        lists();
        return HttpResponse.json(
          offline
            ? [sandbox({ name: '任务 A', status: 'running' })]
            : [
                sandbox({ name: '任务 A', status: 'starting' }),
                sandbox({ id: 'task-b', name: '任务 B', status: 'stopped' }),
              ],
        );
      }),
      http.get(`${API}/api/sandboxes/task-c`, () => {
        details();
        return HttpResponse.json(
          sandbox({
            id: 'task-c',
            name: '新创建的任务 C',
            status: offline ? 'running' : 'starting',
          }),
        );
      }),
    );
    const mounted = mount(
      <AppFrameContainer>
        <RestoredTaskOutsideList />
      </AppFrameContainer>,
    );
    const tree = await screen.findByRole('navigation', { name: '项目分组任务树' });
    await within(tree).findByText('任务 B');
    await screen.findByText('starting', { selector: 'output' });
    const listReads = lists.mock.calls.length;
    const projectReads = projects.mock.calls.length;
    const detailReads = details.mock.calls.length;
    const connection = wire.connections.at(-1);
    if (!connection) throw new Error('Production events connection missing');
    act(() => {
      connection.handlers.get('connect')?.(undefined);
    });
    vi.useFakeTimers();
    act(() => {
      connection.handlers.get('disconnect')?.(undefined);
    });
    expect(screen.getByText(/实时更新已中断/)).toBeInTheDocument();
    offline = true;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const reconnect = wire.connections.at(-1);
    expect(reconnect).not.toBe(connection);
    act(() => {
      reconnect?.handlers.get('connect')?.(undefined);
    });
    vi.useRealTimers();
    await within(tree).findByText('运行中');
    await waitFor(() => {
      expect(within(tree).queryByText('任务 B')).not.toBeInTheDocument();
      expect(screen.getByTestId('restored-outside-list')).toHaveTextContent('running');
      expect(screen.queryByText(/实时更新已中断/)).not.toBeInTheDocument();
      expect(lists.mock.calls.length).toBeGreaterThan(listReads);
      expect(projects.mock.calls.length).toBeGreaterThan(projectReads);
      expect(details.mock.calls.length).toBeGreaterThan(detailReads);
      expect(mounted.client.getQueryData<ProjectDto[]>(projectKeys.all())?.[0]?.taskCount).toBe(1);
    });
    expect(within(tree).queryByText('新创建的任务 C')).not.toBeInTheDocument();
    mounted.unmount();
  });
  it('REQ-EVT-002/REQ-LCH-014: a late pending POST acceptance cannot replace already observed running from real events and list reads', async () => {
    useAppStore.setState({ selectedProjectId: 'project-a' });
    const accepted = deferred();
    let created = false;
    const writes = vi.fn();
    server.use(
      http.get(`${API}/api/projects`, () =>
        HttpResponse.json([project({ taskCount: created ? 1 : 0 })]),
      ),
      http.get(`${API}/api/sandboxes`, () => HttpResponse.json(created ? [sandbox()] : [])),
      http.post(`${API}/api/sandboxes`, async () => {
        created = true;
        writes();
        await accepted.promise;
        return HttpResponse.json(sandbox({ status: 'pending', hasRun: false }), { status: 201 });
      }),
    );
    mount(
      <AppFrameContainer>
        <WorkbenchContainer />
      </AppFrameContainer>,
    );
    const entry = await screen.findByTestId('new-task-entry');
    await waitFor(() => {
      expect(entry).not.toHaveAttribute('aria-disabled', 'true');
    });
    fireEvent.click(entry);
    fireEvent.click(await screen.findByRole('radio', { name: /Codex/ }));
    fireEvent.click(screen.getByTestId('launch-task-submit'));
    await waitFor(() => {
      expect(writes).toHaveBeenCalledOnce();
    });
    const connection = wire.connections.at(-1);
    if (!connection) throw new Error('Production events connection missing');
    act(() => {
      connection.handlers.get('connect')?.(undefined);
      connection.handlers.get('event')?.({
        event: 'sandbox.status_changed',
        sandboxId: 'task-a',
        status: 'running',
      });
    });
    const tree = screen.getByRole('navigation', { name: '项目分组任务树' });
    await within(tree).findByText('运行中');
    expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('running');
    expect(screen.getByTestId('modal-new-task')).toBeInTheDocument();
    act(accepted.release);
    await screen.findByTestId('accepted-terminal');
    expect(useAppStore.getState().selectedSandboxId).toBe('task-a');
    expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('running');
    expect(screen.queryByTestId('sandbox-startup-progress')).not.toBeInTheDocument();
    expect(screen.queryByTestId('modal-new-task')).not.toBeInTheDocument();
  });
});
