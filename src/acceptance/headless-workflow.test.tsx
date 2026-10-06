import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { API, NOW, body, deferred } from './support/fixtures';
import { server } from './support/server';
import { mount } from './support/mount';
import { Connection, first } from './support/transport';
import { HeadlessTaskContainer } from '@/containers/task/HeadlessTaskContainer';
import { useAppStore, partializeAppState } from '@/stores';
import type { AgentTaskDto } from '@/types/task';
const task = (extra: Partial<AgentTaskDto> = {}): AgentTaskDto => ({
  id: 'run-a',
  sandboxId: 'task-a',
  runtime: 'codex',
  status: 'running',
  startedAt: NOW,
  timeoutMinutes: 120,
  lastSeq: 0,
  artifacts: [],
  ...extra,
});
describe('SBX · readonly output → terminate → outcome → explicit continuation', () => {
  it('AC-SBX-032.2/032.3/035.1: termination is confirmed, 202 waits for exit, then continuation consumes only the actual session reference', async () => {
    let rows = [task()];
    const reads = vi.fn();
    const resumed = vi.fn();
    const gate = deferred();
    const connections: Connection[] = [];
    const factory = () => {
      const connection = new Connection();
      connections.push(connection);
      return connection;
    };
    server.use(
      http.get(`${API}/api/sandboxes/task-a/tasks`, () => {
        reads();
        return HttpResponse.json(rows);
      }),
      http.post(`${API}/api/sandboxes/task-a/tasks/run-a/cancel`, async () => {
        await gate.promise;
        return HttpResponse.json(task(), { status: 202 });
      }),
      http.post(`${API}/api/sandboxes/task-a/runtimes/codex/tasks`, async ({ request }) => {
        resumed(await body(request));
        const next = task({ id: 'run-b' });
        rows = [next, ...rows];
        return HttpResponse.json(next, { status: 202 });
      }),
    );
    const { client } = mount(
      <HeadlessTaskContainer
        sandboxId="task-a"
        runtime="codex"
        wsBaseUrl={API}
        headlessTaskSupported
        socketFactory={factory}
      />,
    );
    await screen.findByTestId('task-output-pane');
    const connection = first(connections);
    act(() => {
      connection.connected();
      connection.received({
        type: 'event',
        taskId: 'run-a',
        seq: 1,
        event: { type: 'session-started', timestamp: NOW, data: { ref: 'server-session-a' } },
      });
      connection.received({
        type: 'event',
        taskId: 'run-a',
        seq: 2,
        event: { type: 'agent-message', timestamp: NOW, data: { text: '当前输出保留' } },
      });
    });
    await screen.findByText('当前输出保留');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '终止任务' }));
    const confirm = screen.getByRole('button', { name: '确认终止' });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '终止任务' })).toHaveFocus();
    });
    fireEvent.click(screen.getByRole('button', { name: '终止任务' }));
    fireEvent.click(screen.getByRole('button', { name: '确认终止' }));
    await screen.findByText('正在终止…（两阶段强杀）');
    expect(screen.queryByTestId('task-outcome')).not.toBeInTheDocument();
    act(gate.release);
    await waitFor(() => {
      expect(client.getMutationCache().getAll()[0]?.state.status).toBe('success');
    });
    expect(reads).toHaveBeenCalledTimes(1);
    expect(screen.getByText('正在终止…（两阶段强杀）')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '终止任务' })).not.toBeInTheDocument();
    rows = [task({ status: 'killed', finishedAt: NOW, sessionRef: 'server-session-a' })];
    act(() => {
      connection.received({ type: 'exit', taskId: 'run-a', status: 'killed', exitCode: 137 });
    });
    await screen.findByTestId('task-outcome');
    expect(screen.getByText('当前输出保留')).toBeInTheDocument();
    await waitFor(() => {
      expect(reads).toHaveBeenCalledTimes(2);
    });
    fireEvent.click(screen.getByRole('button', { name: '接着聊（续接这轮会话）' }));
    fireEvent.change(screen.getByLabelText('任务指令'), { target: { value: '再检查一次' } });
    fireEvent.click(screen.getByRole('button', { name: '接着跑（续接会话）' }));
    await waitFor(() => {
      expect(resumed).toHaveBeenCalledWith({
        prompt: '再检查一次',
        timeoutMinutes: 120,
        resumeFrom: 'server-session-a',
      });
    });
    expect(JSON.stringify(partializeAppState(useAppStore.getState()))).not.toContain('再检查一次');
    await waitFor(() => {
      expect(useAppStore.getState().selectedTaskId).toBe('run-b');
    });
    expect(screen.queryByRole('button', { name: '确认终止' })).not.toBeInTheDocument();
  });
});
