import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { API, NOW, deferred, sandbox } from './support/fixtures';
import { server } from './support/server';
import { mount } from './support/mount';
import { useAppStore } from '@/stores';
import { SandboxTerminalContainer } from '@/containers/sandbox/SandboxTerminalContainer';
import * as terminal from '@/containers/terminal/TerminalTabsContainer';
import { PtySocket } from '@/services/ws/ptySocket';
import { TaskSocket } from '@/services/ws/taskSocket';
import { sandboxKeys } from '@/hooks/sandbox/useSandboxRestore';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
function setup() {
  useAppStore.setState({ selectedProjectId: 'project-a', selectedSandboxId: 'task-a' });
  useAppStore.getState().setSandboxStatus('task-a', 'running');
  const attach = vi.spyOn(PtySocket.prototype, 'connect');
  const mounted = vi.spyOn(terminal, 'TerminalTabsContainer');
  const output = vi.spyOn(TaskSocket.prototype, 'connect').mockImplementation(() => undefined);
  server.use(
    http.get(`${API}/api/sandboxes/task-a/tasks`, () =>
      HttpResponse.json([
        {
          id: 'run-a',
          sandboxId: 'task-a',
          runtime: 'codex',
          status: 'running',
          timeoutMinutes: 120,
          lastSeq: 0,
          artifacts: [],
          startedAt: NOW,
        },
      ]),
    ),
  );
  return { attach, mounted, output };
}
const host = (
  <SandboxTerminalContainer
    projectId="project-a"
    projectName="acme-web"
    projectSourceType="empty"
    wsBaseUrl="ws://localhost:3001"
  />
);
describe('AC-SBX-031.1 · list status never authorizes interactive attachment', () => {
  it('running seeded before delayed REST detail renders skeleton, then readonly output, with zero terminal mounts/connections', async () => {
    const probes = setup();
    const gate = deferred();
    const read = vi.fn();
    server.use(
      http.get(`${API}/api/sandboxes/task-a`, async () => {
        read();
        await gate.promise;
        return HttpResponse.json(sandbox({ headless: true, timeoutMinutes: 120 }));
      }),
    );
    mount(host);
    await waitFor(() => {
      expect(read).toHaveBeenCalled();
    });
    expect(screen.getByTestId('sandbox-restore-pending')).toBeInTheDocument();
    expect(probes.mounted).not.toHaveBeenCalled();
    expect(probes.attach).not.toHaveBeenCalled();
    act(gate.release);
    await screen.findByTestId('task-output-pane');
    expect(probes.output).toHaveBeenCalled();
    expect(probes.mounted).not.toHaveBeenCalled();
    expect(probes.attach).not.toHaveBeenCalled();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
  it('unknown mode REST error and retry never attach a terminal', async () => {
    const probes = setup();
    let reads = 0;
    server.use(
      http.get(`${API}/api/sandboxes/task-a`, () =>
        ++reads === 1
          ? HttpResponse.json(
              { code: 'INTERNAL_ERROR', message: 'secret backend data', retryable: true },
              { status: 500 },
            )
          : HttpResponse.json(sandbox({ headless: true })),
      ),
    );
    mount(host);
    expect(await screen.findByTestId('sandbox-restore-error')).toHaveTextContent(
      '暂时无法读取任务详情',
    );
    expect(screen.queryByText('secret backend data')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await screen.findByTestId('task-output-pane');
    expect(probes.attach).not.toHaveBeenCalled();
    expect(probes.mounted).not.toHaveBeenCalled();
  });
  it('complete cached headless mode survives a failed REST refetch without replacing the scene', async () => {
    const probes = setup();
    server.use(
      http.get(`${API}/api/sandboxes/task-a`, () => HttpResponse.json(sandbox({ headless: true }))),
    );
    const { client } = mount(host);
    await screen.findByTestId('task-output-pane');
    server.use(
      http.get(`${API}/api/sandboxes/task-a`, () =>
        HttpResponse.json(
          { code: 'INTERNAL_ERROR', message: 'offline', retryable: true },
          { status: 500 },
        ),
      ),
    );
    await act(async () => {
      await client.invalidateQueries({ queryKey: sandboxKeys.detail('task-a') });
    });
    expect(screen.getByTestId('task-output-pane')).toBeInTheDocument();
    expect(screen.queryByTestId('sandbox-restore-error')).not.toBeInTheDocument();
    expect(probes.attach).not.toHaveBeenCalled();
  });
});
