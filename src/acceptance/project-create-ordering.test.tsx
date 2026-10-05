import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { API, NOW, deferred, project } from './support/fixtures';
import { queryHarness } from './support/mount';
import { server } from './support/server';
import {
  projectKeys,
  useCreateProject,
  useProjects,
  useRetryClone,
} from '@/hooks/project/useProjects';
import { useSandboxEventsSocket } from '@/hooks/sandbox/useSandboxEventsSocket';
import { useAppStore } from '@/stores';
import type { EventsSocketFactory } from '@/services/ws/eventsSocket';
import type { ProjectDto } from '@/types/project';

// Only the transport boundary is scripted; production frame decoding, mutations and stores run.
function eventTransport() {
  let receive: (raw: unknown) => void = (): void => {
    throw new Error('Events connection has not been registered');
  };
  const factory: EventsSocketFactory = () => ({
    onConnect: (callback) => {
      callback();
    },
    onDisconnect: () => {
      /* This scenario keeps the same connection. */
    },
    onConnectError: () => {
      /* No handshake failure is scripted. */
    },
    onEvent: (callback) => {
      receive = callback;
    },
    disconnect: () => {
      /* React cleanup closes the scripted transport. */
    },
  });
  return {
    factory,
    receive: (raw: unknown) => {
      receive(raw);
    },
  };
}

function projectHarness() {
  const harness = queryHarness();
  const wire = eventTransport();
  const hook = renderHook(
    () => {
      useSandboxEventsSocket({ base: API, socketFactory: wire.factory });
      return { create: useCreateProject(), retry: useRetryClone(), projects: useProjects() };
    },
    { wrapper: harness.wrapper },
  );
  return { ...hook, ...harness, wire };
}

const input = {
  name: 'acme-web',
  sourceType: 'git' as const,
  repoUrl: 'https://github.com/acme/web.git',
};

describe('PRJ/EVT · project create acceptance ordering', () => {
  it.each(['done', 'failed', 'slow'] as const)(
    'REQ-PRJ-004/005: a delayed create response preserves an already decoded %s event and its query projection',
    async (phase) => {
      const acceptance = deferred();
      const posted = vi.fn();
      const status = phase === 'done' ? 'ready' : phase === 'failed' ? 'failed' : 'cloning';
      const errorCode = phase === 'failed' ? 'CLONE_FAILED_PERMISSION' : null;
      let created = false;
      server.use(
        http.get(`${API}/api/projects`, () =>
          HttpResponse.json(
            created ? [project({ cloneStatus: status, cloneErrorCode: errorCode })] : [],
          ),
        ),
        http.post(`${API}/api/projects`, async () => {
          created = true;
          posted();
          await acceptance.promise;
          return HttpResponse.json(project({ cloneStatus: 'cloning', cloneErrorCode: null }), {
            status: 202,
          });
        }),
      );
      const { result, client, wire } = projectHarness();
      await waitFor(() => {
        expect(result.current.projects.isSuccess).toBe(true);
      });
      const snapshots: (ProjectDto[] | undefined)[] = [];
      const accepted = vi.fn((value: ProjectDto) => {
        // The container may also request an immediate seed after the mutation's own success handler.
        useAppStore.getState().seedCloneProgress(value.id, { phase: 'cloning' });
        snapshots.push(client.getQueryData<ProjectDto[]>(projectKeys.all()));
      });
      act(() => {
        result.current.create.mutate(input, { onSuccess: accepted });
      });
      await waitFor(() => {
        expect(posted).toHaveBeenCalledOnce();
      });
      act(() => {
        wire.receive({
          event: 'project.clone_progress',
          projectId: 'project-a',
          phase,
          startedAt: NOW,
          stage: 'receiving',
          percent: 77,
          ...(errorCode === null ? {} : { errorCode }),
        });
      });
      const observed = useAppStore.getState().projectClones['project-a'];
      expect(observed?.phase).toBe(phase);
      act(acceptance.release);
      await waitFor(() => {
        expect(accepted).toHaveBeenCalledOnce();
      });
      expect(useAppStore.getState().projectClones['project-a']).toBe(observed);
      expect(observed).toMatchObject({ phase, percent: 77, startedAt: Date.parse(NOW) });
      expect(snapshots[0]).toHaveLength(1);
      expect(snapshots[0]?.[0]).toMatchObject({ cloneStatus: status, cloneErrorCode: errorCode });
      await waitFor(() => {
        expect(result.current.projects.data?.[0]?.cloneStatus).toBe(status);
      });
    },
  );

  it.each(['ready', 'failed'] as const)(
    'REQ-PRJ-004/005: a list read already showing %s is retained once when the create acceptance arrives later',
    async (cloneStatus) => {
      const acceptance = deferred();
      const posted = vi.fn();
      const fresh = project({
        cloneStatus,
        cloneErrorCode: cloneStatus === 'failed' ? 'CLONE_FAILED_NETWORK' : null,
        baselineSizeBytes: 9000,
        updatedAt: '2026-10-05T00:01:00.000Z',
      });
      let created = false;
      server.use(
        http.get(`${API}/api/projects`, () => HttpResponse.json(created ? [fresh] : [])),
        http.post(`${API}/api/projects`, async () => {
          created = true;
          posted();
          await acceptance.promise;
          return HttpResponse.json(
            project({ cloneStatus: 'cloning', cloneErrorCode: null, baselineSizeBytes: 0 }),
            { status: 202 },
          );
        }),
      );
      const { result, client } = projectHarness();
      await waitFor(() => {
        expect(result.current.projects.isSuccess).toBe(true);
      });
      const accepted = vi.fn();
      act(() => {
        result.current.create.mutate(input, { onSuccess: accepted });
      });
      await waitFor(() => {
        expect(posted).toHaveBeenCalledOnce();
      });
      await act(async () => {
        await client.invalidateQueries({ queryKey: projectKeys.all() });
      });
      expect(client.getQueryData(projectKeys.all())).toEqual([fresh]);
      expect(useAppStore.getState().projectClones['project-a']?.phase).toBe(
        cloneStatus === 'ready' ? 'done' : 'failed',
      );
      act(acceptance.release);
      await waitFor(() => {
        expect(accepted).toHaveBeenCalledOnce();
      });
      expect(client.getQueryData(projectKeys.all())).toEqual([fresh]);
      expect(useAppStore.getState().projectClones['project-a']).toMatchObject({
        phase: cloneStatus === 'ready' ? 'done' : 'failed',
      });
      expect(result.current.projects.data).toEqual([fresh]);
    },
  );

  it('REQ-PRJ-014: explicit retry starts a fresh clone and a late retry response preserves its completed event', async () => {
    const acceptance = deferred();
    const posted = vi.fn();
    let completed = false;
    server.use(
      http.get(`${API}/api/projects`, () =>
        HttpResponse.json([
          project({
            cloneStatus: completed ? 'ready' : 'failed',
            cloneErrorCode: completed ? null : 'CLONE_FAILED_NETWORK',
          }),
        ]),
      ),
      http.post(`${API}/api/projects/project-a/retry-clone`, async () => {
        posted();
        await acceptance.promise;
        return HttpResponse.json(project({ cloneStatus: 'cloning', cloneErrorCode: null }), {
          status: 202,
        });
      }),
    );
    useAppStore.getState().setCloneProgress('project-a', {
      phase: 'failed',
      errorCode: 'CLONE_FAILED_NETWORK',
      percent: 48,
      startedAt: Date.parse(NOW),
    });
    const { result, wire } = projectHarness();
    await waitFor(() => {
      expect(result.current.projects.isSuccess).toBe(true);
    });
    act(() => {
      result.current.retry.mutate('project-a');
    });
    await waitFor(() => {
      expect(posted).toHaveBeenCalledOnce();
    });
    expect(useAppStore.getState().projectClones['project-a']).toEqual({ phase: 'cloning' });
    act(() => {
      wire.receive({
        event: 'project.clone_progress',
        projectId: 'project-a',
        phase: 'cloning',
        startedAt: '2026-10-05T00:01:00.000Z',
        percent: 20,
      });
      completed = true;
      wire.receive({
        event: 'project.clone_progress',
        projectId: 'project-a',
        phase: 'done',
        percent: 100,
      });
    });
    act(acceptance.release);
    await waitFor(() => {
      expect(result.current.retry.isSuccess).toBe(true);
    });
    expect(useAppStore.getState().projectClones['project-a']).toMatchObject({
      phase: 'done',
      percent: 100,
      startedAt: Date.parse('2026-10-05T00:01:00.000Z'),
    });
    await waitFor(() => {
      expect(result.current.projects.data?.[0]?.cloneStatus).toBe('ready');
    });
  });

  it('REQ-PRJ-004: acceptance without an earlier event seeds one pending clone immediately', async () => {
    let created = false;
    server.use(
      http.get(`${API}/api/projects`, () =>
        HttpResponse.json(created ? [project({ cloneStatus: 'cloning' })] : []),
      ),
      http.post(`${API}/api/projects`, () => {
        created = true;
        return HttpResponse.json(project({ cloneStatus: 'cloning' }), { status: 202 });
      }),
    );
    const { result, client } = projectHarness();
    await waitFor(() => {
      expect(result.current.projects.isSuccess).toBe(true);
    });
    act(() => {
      result.current.create.mutate(input);
    });
    await waitFor(() => {
      expect(result.current.create.isSuccess).toBe(true);
    });
    expect(useAppStore.getState().projectClones['project-a']).toEqual({ phase: 'cloning' });
    expect(client.getQueryData<ProjectDto[]>(projectKeys.all())).toHaveLength(1);
  });

  it.each(['ready', 'failed'] as const)(
    'REQ-EVT-002/REQ-PRJ-004: a fresh delayed list read repairs an old slow clone to %s after a missed event',
    async (cloneStatus) => {
      const response = deferred();
      const reads = vi.fn();
      let read = 0;
      server.use(
        http.get(`${API}/api/projects`, async () => {
          reads();
          if (++read === 1)
            return HttpResponse.json([project({ cloneStatus: 'cloning', cloneErrorCode: null })]);
          await response.promise;
          return HttpResponse.json([
            project({
              cloneStatus,
              cloneErrorCode: cloneStatus === 'failed' ? 'CLONE_FAILED_NETWORK' : null,
            }),
          ]);
        }),
      );
      useAppStore
        .getState()
        .setCloneProgress('project-a', { phase: 'slow', percent: 25, startedAt: Date.parse(NOW) });
      const { result } = projectHarness();
      await waitFor(() => {
        expect(result.current.projects.isSuccess).toBe(true);
      });
      expect(useAppStore.getState().projectClones['project-a']?.phase).toBe('slow');
      act(() => {
        void result.current.projects.refetch();
      });
      await waitFor(() => {
        expect(reads).toHaveBeenCalledTimes(2);
      });
      expect(useAppStore.getState().projectClones['project-a']?.phase).toBe('slow');
      act(response.release);
      await waitFor(() => {
        expect(result.current.projects.data?.[0]?.cloneStatus).toBe(cloneStatus);
      });
      expect(useAppStore.getState().projectClones['project-a']).toEqual(
        cloneStatus === 'ready'
          ? { phase: 'done' }
          : { phase: 'failed', errorCode: 'CLONE_FAILED_NETWORK' },
      );
    },
  );

  it.each([
    { phase: 'done' as const, staleStatus: 'cloning' as const },
    { phase: 'failed' as const, staleStatus: 'ready' as const },
  ])(
    'REQ-EVT-002: a $phase event received while GET is pending survives its older $staleStatus response',
    async ({ phase, staleStatus }) => {
      const response = deferred();
      const reads = vi.fn();
      let read = 0;
      server.use(
        http.get(`${API}/api/projects`, async () => {
          reads();
          if (++read === 1)
            return HttpResponse.json([project({ cloneStatus: 'cloning', cloneErrorCode: null })]);
          await response.promise;
          return HttpResponse.json([project({ cloneStatus: staleStatus, cloneErrorCode: null })]);
        }),
      );
      const { result, wire } = projectHarness();
      await waitFor(() => {
        expect(result.current.projects.isSuccess).toBe(true);
      });
      act(() => {
        void result.current.projects.refetch();
      });
      await waitFor(() => {
        expect(reads).toHaveBeenCalledTimes(2);
      });
      act(() => {
        wire.receive({
          event: 'project.clone_progress',
          projectId: 'project-a',
          phase,
          ...(phase === 'failed' ? { errorCode: 'CLONE_FAILED_PERMISSION' } : {}),
        });
      });
      const observed = useAppStore.getState().projectClones['project-a'];
      act(response.release);
      await waitFor(() => {
        expect(result.current.projects.isFetching).toBe(false);
      });
      expect(useAppStore.getState().projectClones['project-a']).toBe(observed);
      expect(result.current.projects.data?.[0]).toMatchObject({
        cloneStatus: phase === 'done' ? 'ready' : 'failed',
        cloneErrorCode: phase === 'failed' ? 'CLONE_FAILED_PERMISSION' : null,
      });
    },
  );
});
