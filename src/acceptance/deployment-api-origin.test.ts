import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './support/server';

const PRODUCTION_API = 'https://agent-api.douglasdong.com';
const PREVIEW_API = 'https://agent-api-preview.douglasdong.com';
const wire = vi.hoisted(() => ({
  io: vi.fn(() => ({
    on: vi.fn(() => undefined),
    emit: vi.fn(() => undefined),
    disconnect: vi.fn(() => undefined),
  })),
}));

// The external Socket.IO driver is the only scripted boundary. The production
// channel adapters, namespace/query construction, credential options and teardown run.
vi.mock('socket.io-client', () => ({ io: wire.io }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', PRODUCTION_API);
  wire.io.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Deployment · one API host for HTTP streams, unlock and sockets', () => {
  it.each([PRODUCTION_API, PREVIEW_API])(
    'unlock and typed REST both use the configured API host %s with credentials',
    async (origin) => {
      vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', origin);
      const observed: { url: string; credentials: RequestCredentials }[] = [];
      server.use(
        http.post(`${origin}/api/access/unlock`, async ({ request }) => {
          observed.push({ url: request.url, credentials: request.credentials });
          expect(await request.json()).toEqual({ passcode: 'acceptance-passcode' });
          return new HttpResponse(null, { status: 204 });
        }),
        http.get(`${origin}/api/health`, ({ request }) => {
          observed.push({ url: request.url, credentials: request.credentials });
          return HttpResponse.json({ status: 'ok' });
        }),
      );
      const { submitPasscode } = await import('@/services/api/access.service');
      const { getHealth } = await import('@/services/api/health.service');

      await submitPasscode('acceptance-passcode');
      await expect(getHealth()).resolves.toEqual({ ok: true, status: 200 });

      expect(observed).toEqual([
        { url: `${origin}/api/access/unlock`, credentials: 'include' },
        { url: `${origin}/api/health`, credentials: 'include' },
      ]);
    },
  );

  it('diagnostic and image SSE POSTs stream directly from the same API with credentials', async () => {
    const observed: { url: string; credentials: RequestCredentials; accept: string | null }[] = [];
    server.use(
      http.post(`${PRODUCTION_API}/api/system/diagnose`, ({ request }) => {
        observed.push({
          url: request.url,
          credentials: request.credentials,
          accept: request.headers.get('Accept'),
        });
        return new HttpResponse(
          `data: ${JSON.stringify({ event: 'start', checks: [], timeoutMs: 1000 })}\n\n` +
            `data: ${JSON.stringify({ event: 'done', okCount: 0, infoCount: 0, warnCount: 0, failCount: 0, totalMs: 1 })}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream', 'X-Schema-Hash': 'deployed-schema' } },
        );
      }),
      http.post(`${PRODUCTION_API}/api/system/preset-image/provision`, ({ request }) => {
        observed.push({
          url: request.url,
          credentials: request.credentials,
          accept: request.headers.get('Accept'),
        });
        return new HttpResponse('data: {"event":"done","ok":true}\n\n', {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );
    const { diagnose, provisionPresetImage } = await import('@/services/api/system.service');
    const diagnosed = vi.fn();
    const provisioned = vi.fn();
    const mismatch = vi.fn();

    await diagnose({
      onStart: vi.fn(),
      onCheck: vi.fn(),
      onDone: diagnosed,
      onSchemaMismatch: mismatch,
    });
    await provisionPresetImage({ onStage: vi.fn(), onDone: provisioned });

    expect(diagnosed).toHaveBeenCalledOnce();
    expect(provisioned).toHaveBeenCalledWith({ event: 'done', ok: true });
    expect(mismatch).toHaveBeenCalledWith('deployed-schema');
    expect(observed).toEqual([
      {
        url: `${PRODUCTION_API}/api/system/diagnose`,
        credentials: 'include',
        accept: 'text/event-stream',
      },
      {
        url: `${PRODUCTION_API}/api/system/preset-image/provision`,
        credentials: 'include',
        accept: 'text/event-stream',
      },
    ]);
  });

  it('artifact streams and retained-volume download links stay on the API host', async () => {
    const observed = vi.fn();
    server.use(
      http.get(
        `${PRODUCTION_API}/api/sandboxes/task-a/tasks/run-a/artifacts/:name`,
        ({ request }) => {
          observed(request.credentials);
          return new HttpResponse('result bytes', {
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': 'attachment; filename="result.txt"',
            },
          });
        },
      ),
    );
    const { fetchTaskArtifact } = await import('@/services/api/task.service');
    const { retainedVolumeArchiveUrl } = await import('@/services/api/retainedVolume.service');

    const response = await fetchTaskArtifact('task-a', 'run-a', 'result.txt');
    expect(await response.text()).toBe('result bytes');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="result.txt"');
    expect(observed).toHaveBeenCalledWith('include');
    expect(retainedVolumeArchiveUrl('retained-a')).toBe(
      `${PRODUCTION_API}/api/retained-volumes/retained-a/archive`,
    );
  });

  it('all three production Socket.IO adapters use the API host and credentialed websocket transport', async () => {
    const { buildEventsSocketUri } = await import('@/lib/sandbox/sandboxLifecycle');
    const { buildTasksSocketUri, buildTasksSocketQuery } =
      await import('@/lib/task/taskSocketConfig');
    const { buildTerminalSocketConfig } = await import('@/lib/terminal/terminalSocket');
    const { EventsSocket } = await import('@/services/ws/eventsSocket');
    const { TaskSocket } = await import('@/services/ws/taskSocket');
    const { PtySocket } = await import('@/services/ws/ptySocket');
    const events = new EventsSocket({
      uri: buildEventsSocketUri(PRODUCTION_API),
      onEvent: vi.fn(),
      onState: vi.fn(),
    });
    const task = new TaskSocket({
      uri: buildTasksSocketUri(PRODUCTION_API),
      query: buildTasksSocketQuery('task-a'),
      onFrame: vi.fn(),
      onState: vi.fn(),
    });
    const terminal = new PtySocket({
      ...buildTerminalSocketConfig(PRODUCTION_API, 'task-a', { cols: 132, rows: 47 }),
      onFrame: vi.fn(),
      onState: vi.fn(),
    });

    events.connect();
    task.connect();
    terminal.connect();

    const expectedTransport = {
      transports: ['websocket'],
      withCredentials: true,
      forceNew: true,
      reconnection: false,
    };
    expect(wire.io).toHaveBeenNthCalledWith(1, `${PRODUCTION_API}/events`, expectedTransport);
    expect(wire.io).toHaveBeenNthCalledWith(2, `${PRODUCTION_API}/tasks`, {
      ...expectedTransport,
      query: { sandboxId: 'task-a', xSchemaHash: 'sb-tasks-v1' },
    });
    expect(wire.io).toHaveBeenNthCalledWith(3, `${PRODUCTION_API}/terminal`, {
      ...expectedTransport,
      query: { sandboxId: 'task-a', cols: '132', rows: '47', xSchemaHash: 'sb-terminal-v4' },
    });

    events.close();
    task.close();
    terminal.close();
    for (const connection of wire.io.mock.results) {
      expect(connection.value.disconnect).toHaveBeenCalledOnce();
    }
  });
});
