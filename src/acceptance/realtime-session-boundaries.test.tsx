import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { API, NOW } from './support/fixtures';
import { server } from './support/server';
import { useTaskStream } from '@/hooks/task/useTaskStream';
import { useSandboxTerminalSocket } from '@/hooks/terminal/useSandboxTerminalSocket';
import { diagnose } from '@/services/api/system.service';
import { stopSandbox } from '@/services/api/sandbox.service';
import {
  TaskServerFrameSchema,
  TerminalServerFrameSchema,
  SandboxEventSchema,
} from '@/types/ws-protocol';
import { buildTerminalSocketConfig } from '@/lib/terminal/terminalSocket';
import { partializeAppState, useAppStore } from '@/stores';
import type { TaskSocketFactoryArgs } from '@/types/taskSocket';

import { Connection, first } from './support/transport';
const event = (seq: number, text: string) => ({
  type: 'event',
  taskId: 'run-a',
  seq,
  event: { type: 'agent-message', timestamp: NOW, data: { text } },
});
function transport() {
  const connections: Connection[] = [];
  const handshakes: TaskSocketFactoryArgs[] = [];
  return {
    connections,
    handshakes,
    factory: (args: TaskSocketFactoryArgs) => {
      handshakes.push(args);
      const connection = new Connection();
      connections.push(connection);
      return connection;
    },
  };
}
describe('EVT/TRM/SBX · wire and session acceptance', () => {
  it('REQ-SBX-033: disconnect preserves output, reconnect subscribes after last sequence, and duplicate frames do not duplicate text', () => {
    vi.useFakeTimers();
    const io = transport();
    const { result } = renderHook(() =>
      useTaskStream({
        base: 'ws://localhost:3001',
        sandboxId: 'task-a',
        taskId: 'run-a',
        socketFactory: io.factory,
      }),
    );
    const a = first(io.connections);
    act(() => {
      a.connected();
      a.received(event(1, '第一条'));
      a.received(event(2, '第二条'));
      a.disconnected();
      vi.advanceTimersByTime(31000);
    });
    const b = io.connections[1];
    if (!b) throw new Error('No reconnect');
    act(() => {
      b.connected();
      b.received(event(2, '第二条'));
      b.received(event(3, '补回第三条'));
    });
    expect(b.sent).toContainEqual({ type: 'subscribe', taskId: 'run-a', fromSeq: 2 });
    expect(result.current.stream.items).toHaveLength(3);
    expect(result.current.stream.lastSeq).toBe(3);
    expect(io.handshakes[0]?.query).toMatchObject({
      sandboxId: 'task-a',
      xSchemaHash: 'sb-tasks-v1',
    });
  });
  it('REQ-SBX-033: bounded retry ends closed; explicit reconnect preserves the scene and only requests the missing suffix', () => {
    vi.useFakeTimers();
    const io = transport();
    const { result } = renderHook(() =>
      useTaskStream({
        base: API,
        sandboxId: 'task-a',
        taskId: 'run-a',
        socketFactory: io.factory,
        maxReconnect: 1,
      }),
    );
    const a = first(io.connections);
    act(() => {
      a.connected();
      a.received(event(1, '保留的输出'));
      a.disconnected();
      vi.advanceTimersByTime(31000);
    });
    const b = io.connections[1];
    if (!b) throw new Error('No retry');
    act(() => {
      b.failed();
    });
    expect(result.current.connState).toBe('closed');
    expect(result.current.stream.items).toHaveLength(1);
    act(() => {
      result.current.reconnect();
    });
    const c = io.connections[2];
    if (!c) throw new Error('No manual retry');
    act(() => {
      c.connected();
    });
    expect(c.sent).toContainEqual({ type: 'subscribe', taskId: 'run-a', fromSeq: 1 });
    expect(result.current.stream.items).toHaveLength(1);
  });
  it('REQ-SBX-034: terminal exit is delivered once, does not initiate REST polling, and stops further reconnects', () => {
    vi.useFakeTimers();
    const io = transport();
    const exit = vi.fn();
    const { result } = renderHook(() =>
      useTaskStream({
        base: API,
        sandboxId: 'task-a',
        taskId: 'run-a',
        socketFactory: io.factory,
        onExit: exit,
      }),
    );
    const a = first(io.connections);
    act(() => {
      a.connected();
      a.received(event(1, '输出'));
      a.received({ type: 'exit', taskId: 'run-a', status: 'failed', exitCode: 1 });
      a.received({ type: 'exit', taskId: 'run-a', status: 'failed', exitCode: 1 });
      a.disconnected();
      vi.advanceTimersByTime(120000);
      result.current.reconnect();
    });
    expect(exit).toHaveBeenCalledOnce();
    expect(result.current.stream.exit).toMatchObject({ status: 'failed', exitCode: 1 });
    expect(io.connections).toHaveLength(1);
  });
  it('AC-TRM-003/004: PTY reconnect reuses server session/shell identity and starts at the fitted size', () => {
    vi.useFakeTimers();
    const io = transport();
    const frame = vi.fn();
    const { unmount } = renderHook(() =>
      useSandboxTerminalSocket({
        ...buildTerminalSocketConfig(API, 'task-a', { cols: 132, rows: 47 }),
        socketFactory: io.factory,
        onFrame: frame,
      }),
    );
    const a = first(io.connections);
    act(() => {
      a.connected();
      a.received({
        type: 'session',
        socketSessionKey: 'opaque-server-key',
        shellId: 'server-shell',
      });
      a.received({ type: 'data', data: '保留下来的字节' });
      a.disconnected();
      vi.advanceTimersByTime(31000);
    });
    expect(io.handshakes[1]?.query).toMatchObject({
      cols: '132',
      rows: '47',
      socketSessionKey: 'opaque-server-key',
      shellId: 'server-shell',
      xSchemaHash: 'sb-terminal-v4',
    });
    expect(frame).toHaveBeenCalledWith({ type: 'data', data: '保留下来的字节' });
    unmount();
  });
  it('REQ-EVT/REQ-TRM: malformed wire frames cannot masquerade as runtime output or clone progress', () => {
    expect(
      TaskServerFrameSchema.safeParse({
        type: 'event',
        taskId: 'run-a',
        seq: 1,
        event: { type: 'agent-message', timestamp: NOW, data: { chunk: 'wrong field' } },
      }).success,
    ).toBe(false);
    expect(
      TerminalServerFrameSchema.safeParse({ type: 'session', socketSessionKey: 123 }).success,
    ).toBe(false);
    expect(
      SandboxEventSchema.safeParse({
        event: 'project.clone_progress',
        projectId: 'project-a',
        phase: 'made-up',
      }).success,
    ).toBe(false);
    expect(
      SandboxEventSchema.safeParse({
        event: 'project.clone_progress',
        projectId: 'project-a',
        phase: 'cloning',
        startedAt: NOW,
      }).success,
    ).toBe(true);
  });
  it('AC-DEP-009: chunked diagnostic frames decode at boundaries, include cookies, and tolerate a known-item response with a newer schema', async () => {
    const request = vi.fn();
    const check = vi.fn();
    const done = vi.fn();
    const mismatch = vi.fn();
    server.use(
      http.post(`${API}/api/system/diagnose`, ({ request: incoming }) => {
        request(incoming.credentials);
        const bytes = new TextEncoder().encode(
          `data: ${JSON.stringify({ event: 'start', checks: [{ id: 'disk-space', label: '磁盘' }], timeoutMs: 1000 })}\n\ndata: ${JSON.stringify({ event: 'check', id: 'disk-space', label: '磁盘', status: 'ok', headline: '空间足够', durationMs: 1 })}\n\ndata: ${JSON.stringify({ event: 'done', okCount: 1, infoCount: 0, warnCount: 0, failCount: 0, totalMs: 1 })}\n\n`,
        );
        return new HttpResponse(
          new ReadableStream({
            start(controller) {
              controller.enqueue(bytes.slice(0, 17));
              controller.enqueue(bytes.slice(17, 57));
              controller.enqueue(bytes.slice(57));
              controller.close();
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream', 'X-Schema-Hash': 'newer-diagnose' } },
        );
      }),
    );
    await diagnose({ onStart: vi.fn(), onCheck: check, onDone: done, onSchemaMismatch: mismatch });
    expect(request).toHaveBeenCalledWith('include');
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ headline: '空间足够' }));
    expect(done).toHaveBeenCalledOnce();
    expect(mismatch).toHaveBeenCalledWith('newer-diagnose');
  });
  it('REQ-EVT: typed HTTP operation sends credentials and retains the structured error boundary', async () => {
    const sent = vi.fn();
    server.use(
      http.post(`${API}/api/sandboxes/task-a/stop`, ({ request }) => {
        sent(request.credentials);
        return HttpResponse.json(
          { code: 'INVALID_STATE', message: 'private backend message', retryable: false },
          { status: 409 },
        );
      }),
    );
    await expect(stopSandbox('task-a')).rejects.toMatchObject({
      httpStatus: 409,
      envelope: { code: 'INVALID_STATE' },
    });
    expect(sent).toHaveBeenCalledWith('include');
  });
  it('AC-LCH/AC-SBX persistence: only object selection/preferences survive; prompts, progress, repository URLs and session credentials remain in memory', () => {
    const state = useAppStore.getState();
    state.setSelectedProjectId('project-a');
    state.setSelectedSandboxId('task-a');
    state.setSelectedTaskId('run-a');
    state.setPendingProjectCreate({
      projectId: 'project-a',
      name: 'private',
      source: 'git',
      url: 'https://private.invalid/repo',
    });
    state.setCloneProgress('project-a', { phase: 'cloning', stage: 'receiving' });
    state.setWorkbenchNotice({ message: 'local-only-detail' });
    const persisted = partializeAppState(useAppStore.getState());
    expect(persisted).toMatchObject({
      selectedProjectId: 'project-a',
      selectedSandboxId: 'task-a',
      selectedTaskId: 'run-a',
    });
    expect(JSON.stringify(persisted)).not.toContain('private.invalid');
    expect(JSON.stringify(persisted)).not.toContain('local-only-detail');
    expect(persisted).not.toHaveProperty('projectClones');
    expect(persisted).not.toHaveProperty('sandboxStatuses');
    expect(persisted).not.toHaveProperty('pendingProjectCreate');
    expect(persisted).not.toHaveProperty('socketSessionKey');
    expect(persisted).not.toHaveProperty('initialPrompt');
  });
});
