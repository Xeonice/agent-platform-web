import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './support/server';
import { queryHarness } from './support/mount';
import { API, deferred } from './support/fixtures';
import { attemptFixture, upgradeFixture, DIGEST_B, UPGRADE_TEST_TIME } from '@/mocks/upgrade';
import * as upgradeService from '@/services/api/upgrade.service';
import { useInstanceUpgrade, UPGRADE_STATUS_KEY } from '@/hooks/system/useInstanceUpgrade';
import { upgradePendingKey } from '@/lib/system/upgradeRequestIdentity';
import type { UpgradeAttempt, UpgradeOperation, UpgradeStatus } from '@/types/upgrade';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/services/system/loadedWebBuild', () => ({
  loadedWebBuild: { webRevision: 'a'.repeat(40), releaseId: '0.2.4', builtAt: null },
}));

const REQUEST_A = '00000000-0000-4000-8000-000000000002';
const REQUEST_B = '00000000-0000-4000-8000-000000000012';
const REQUEST_C = '00000000-0000-4000-8000-000000000022';
const DIGEST_C = `sha256:${'c'.repeat(64)}`;

function oldOperation(state: UpgradeOperation['state']): UpgradeOperation {
  return {
    instanceId: 'instance-a',
    operationId: '00000000-0000-4000-8000-000000000003',
    requestId: REQUEST_A,
    sequence: 3,
    finalTargetReleaseId: '0.2.5',
    finalTargetDigest: DIGEST_B,
    state,
    acceptedAt: UPGRADE_TEST_TIME,
    observedAt: UPGRADE_TEST_TIME,
    currentStageIndex: 0,
    stages: [
      {
        releaseId: '0.2.5',
        targetDigest: DIGEST_B,
        attemptId:
          state === 'accepted' || state === 'preparing'
            ? null
            : '00000000-0000-4000-8000-000000000001',
        state:
          state === 'completed'
            ? 'confirmed'
            : state === 'failed' || state === 'deferred' || state === 'running'
              ? state
              : 'pending',
      },
    ],
    percent: state === 'completed' ? 100 : null,
    reason: null,
  };
}
function oldAttempt(state: UpgradeAttempt['state']): UpgradeAttempt {
  return {
    ...attemptFixture(),
    state,
    ...(state === 'activation-confirmed' ? { percent: 100, completedWork: 100 } : {}),
  };
}
function latestStatus(running = false): UpgradeStatus {
  const base = upgradeFixture();
  if (base.confirmedServiceRelease === null) throw new Error('missing confirmed fixture');
  const confirmed = {
    ...base.confirmedServiceRelease,
    releaseId: '0.2.6',
    activationGeneration: 9,
    components: {
      ...base.confirmedServiceRelease.components,
      web: {
        ...base.confirmedServiceRelease.components.web,
        artifactDigest: DIGEST_C,
        webRevision: 'c'.repeat(40),
      },
    },
    productionWebBinding: 'instance-a/web-c',
  };
  return {
    ...base,
    observedAt: new Date().toISOString(),
    activationGeneration: running ? 7 : 9,
    confirmedServiceRelease: running ? null : confirmed,
    lastConfirmedServiceRelease: running ? base.confirmedServiceRelease : confirmed,
    serviceState: running ? 'transitioning' : 'confirmed',
    catalog: { state: 'no-update', observedAt: null, reason: null, availableRelease: null },
    operation: {
      ...oldOperation(running ? 'running' : 'completed'),
      operationId: '00000000-0000-4000-8000-000000000013',
      requestId: REQUEST_B,
      finalTargetReleaseId: '0.2.6',
      finalTargetDigest: DIGEST_C,
      stages: [
        {
          releaseId: '0.2.6',
          targetDigest: DIGEST_C,
          attemptId: '00000000-0000-4000-8000-000000000011',
          state: running ? 'running' : 'confirmed',
        },
      ],
    },
    attempt: {
      ...attemptFixture(),
      attemptId: '00000000-0000-4000-8000-000000000011',
      requestId: REQUEST_B,
      targetReleaseId: '0.2.6',
      targetDigest: DIGEST_C,
      generation: 9,
      state: running ? 'observing' : 'activation-confirmed',
      percent: running ? 70 : 100,
    },
    availableWeb: running
      ? null
      : {
          releaseId: '0.2.6',
          webReleaseId: '0.2.6',
          webRevision: 'c'.repeat(40),
          artifactDigest: DIGEST_C,
          instanceId: base.instanceId,
          activationGeneration: 9,
          productionBinding: confirmed.productionWebBinding,
          ready: true,
          compatible: true,
          observedAt: new Date().toISOString(),
        },
  };
}
function persist(status: UpgradeStatus, requestId = REQUEST_A, preferAsync = true) {
  const key = upgradePendingKey(status.instanceId, status.userScope);
  localStorage.setItem(key, JSON.stringify({ version: 1, requestId, preferAsync }));
  return key;
}
function wireStatus(read: () => UpgradeStatus) {
  const posts = vi.fn();
  server.use(
    http.get(`${API}/api/system/upgrade/status`, () =>
      HttpResponse.json({ ...read(), observedAt: new Date().toISOString() }),
    ),
    http.post(`${API}/api/system/upgrade/requests`, () => {
      posts();
      return HttpResponse.error();
    }),
  );
  return posts;
}

describe('UPG · original request restoration after a later serial upgrade', () => {
  it.each([
    { name: 'async completed', async: true, response: oldOperation('completed') },
    { name: 'async failed', async: true, response: oldOperation('failed') },
    { name: 'async deferred', async: true, response: oldOperation('deferred') },
    { name: 'legacy confirmed', async: false, response: oldAttempt('activation-confirmed') },
    { name: 'legacy failed', async: false, response: oldAttempt('failed') },
    { name: 'legacy deferred', async: false, response: oldAttempt('deferred') },
    { name: 'legacy rejected', async: false, response: oldAttempt('candidate-rejected') },
    { name: 'legacy reverted', async: false, response: oldAttempt('reverted') },
  ])(
    '$name clears only A while preserving confirmed B and its refresh qualification',
    async (row) => {
      const status = latestStatus();
      const key = persist(status, REQUEST_A, row.async);
      const posts = wireStatus(() => status);
      const lookups: string[] = [];
      server.use(
        http.get(`${API}/api/system/upgrade/requests/:requestId`, ({ params, request }) => {
          lookups.push(String(params['requestId']));
          expect(request.headers.get('Prefer')).toBe(row.async ? 'respond-async' : null);
          return HttpResponse.json(row.response);
        }),
      );
      const { wrapper, client } = queryHarness();
      const { result } = renderHook(useInstanceUpgrade, { wrapper });
      await waitFor(() => {
        expect(lookups).toContain(REQUEST_A);
        expect(localStorage.getItem(key)).toBeNull();
        expect(result.current.busy).toBe(false);
      });
      expect(result.current.model.phase).toBe('ready');
      expect(result.current.model.canRefresh).toBe(true);
      expect(result.current.observation?.snapshot?.operation).toEqual(status.operation);
      expect(result.current.observation?.snapshot?.confirmedServiceRelease).toEqual(
        status.confirmedServiceRelease,
      );
      expect(client.getQueryData(UPGRADE_STATUS_KEY)).toEqual(result.current.observation);
      expect(result.current.commandMessage).toBeNull();
      expect(new Set(lookups)).toEqual(new Set([REQUEST_A]));
      expect(posts).not.toHaveBeenCalled();
    },
  );

  it('completed A cannot activate B while B is still running', async () => {
    const status = latestStatus(true);
    const key = persist(status);
    const posts = wireStatus(() => status);
    server.use(
      http.get(`${API}/api/system/upgrade/requests/:requestId`, () =>
        HttpResponse.json(oldOperation('completed')),
      ),
    );
    const { wrapper } = queryHarness();
    const { result } = renderHook(useInstanceUpgrade, { wrapper });
    await waitFor(() => {
      expect(localStorage.getItem(key)).toBeNull();
      expect(result.current.model.phase).toBe('ongoing');
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.model.percent).toBeNull();
    expect(result.current.model.canRefresh).toBe(false);
    expect(result.current.observation?.snapshot?.operation).toEqual(status.operation);
    expect(result.current.observation?.snapshot?.attempt).toEqual(status.attempt);
    expect(result.current.observation?.snapshot?.serviceState).toBe('transitioning');
    expect(posts).not.toHaveBeenCalled();
  });

  it.each(['preparing', 'legacy-running', 'unknown', '404', 'network'])(
    '%s keeps querying A without a new POST',
    async (kind) => {
      const status = latestStatus();
      const key = persist(status, REQUEST_A, kind !== 'legacy-running');
      const posts = wireStatus(() => status);
      const lookups: string[] = [];
      server.use(
        http.get(`${API}/api/system/upgrade/requests/:requestId`, ({ params }) => {
          lookups.push(String(params['requestId']));
          if (kind === 'network') return HttpResponse.error();
          if (kind === '404') return HttpResponse.json({}, { status: 404 });
          if (kind === 'unknown')
            return HttpResponse.json({ ...oldOperation('preparing'), state: 'unknown' });
          return HttpResponse.json(
            kind === 'legacy-running' ? oldAttempt('downloading') : oldOperation('preparing'),
          );
        }),
      );
      const { wrapper } = queryHarness();
      const { result } = renderHook(useInstanceUpgrade, { wrapper });
      await waitFor(() => {
        expect(lookups.length).toBeGreaterThan(0);
      });
      await waitFor(
        () => {
          expect(lookups.length).toBeGreaterThan(1);
        },
        { timeout: 4000 },
      );
      expect(result.current.model.phase).toBe('pending');
      expect(result.current.busy).toBe(true);
      expect(localStorage.getItem(key)).toContain(REQUEST_A);
      expect(new Set(lookups)).toEqual(new Set([REQUEST_A]));
      expect(posts).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      name: 'async wrong request',
      async: true,
      response: { ...oldOperation('completed'), requestId: REQUEST_C },
    },
    {
      name: 'async wrong instance',
      async: true,
      response: { ...oldOperation('completed'), instanceId: 'instance-other' },
    },
    {
      name: 'legacy wrong request',
      async: false,
      response: { ...oldAttempt('activation-confirmed'), requestId: REQUEST_C },
    },
    {
      name: 'legacy wrong instance',
      async: false,
      response: { ...oldAttempt('activation-confirmed'), instanceId: 'instance-other' },
    },
  ])('$name cannot resolve A', async (row) => {
    const status = latestStatus();
    const key = persist(status, REQUEST_A, row.async);
    const posts = wireStatus(() => status);
    const lookup = vi.spyOn(upgradeService, 'lookupUpgradeRequest');
    server.use(
      http.get(`${API}/api/system/upgrade/requests/:requestId`, () =>
        HttpResponse.json(row.response),
      ),
    );
    const { wrapper } = queryHarness();
    const { result } = renderHook(useInstanceUpgrade, { wrapper });
    await waitFor(() => {
      expect(lookup).toHaveBeenCalled();
    });
    await act(async () => {
      await lookup.mock.results[0]?.value;
    });
    expect(result.current.model.phase).toBe('pending');
    expect(localStorage.getItem(key)).toContain(REQUEST_A);
    expect(result.current.observation?.snapshot?.operation).toEqual(status.operation);
    expect(posts).not.toHaveBeenCalled();
  });

  it.each(['instance', 'viewer'])(
    'late A cannot clear the new %s scope pending C',
    async (kind) => {
      let status = latestStatus();
      const oldKey = persist(status);
      const gate = deferred();
      const posts = wireStatus(() => status);
      const lookup = vi.spyOn(upgradeService, 'lookupUpgradeRequest');
      server.use(
        http.get(`${API}/api/system/upgrade/requests/:requestId`, async ({ params }) => {
          if (params['requestId'] === REQUEST_A) {
            await gate.promise;
            return HttpResponse.json(oldOperation('completed'));
          }
          return HttpResponse.json({
            ...oldOperation('preparing'),
            instanceId: status.instanceId,
            requestId: REQUEST_C,
          });
        }),
      );
      const { wrapper } = queryHarness();
      const { result } = renderHook(useInstanceUpgrade, { wrapper });
      await waitFor(() => {
        expect(lookup).toHaveBeenCalledWith(REQUEST_A, undefined, true);
      });
      const oldLookup = lookup.mock.results[0]?.value;
      status = {
        ...latestStatus(),
        instanceId: kind === 'instance' ? 'instance-new' : 'instance-a',
        userScope: 'viewer-new',
      };
      const newKey = persist(status, REQUEST_C);
      await act(async () => {
        await result.current.check();
      });
      await waitFor(() => {
        expect(lookup).toHaveBeenCalledWith(REQUEST_C, undefined, true);
      });
      await act(async () => {
        gate.release();
        await oldLookup;
      });
      expect(result.current.busy).toBe(true);
      expect(result.current.model.phase).toBe('pending');
      expect(localStorage.getItem(newKey)).toContain(REQUEST_C);
      expect(localStorage.getItem(oldKey)).toContain(REQUEST_A);
      expect(result.current.observation?.snapshot?.instanceId).toBe(status.instanceId);
      expect(result.current.observation?.snapshot?.userScope).toBe(status.userScope);
      expect(posts).not.toHaveBeenCalled();
    },
  );

  it('late A cannot clear C submitted normally after A completes in the same scope', async () => {
    let status = upgradeFixture();
    const key = persist(status);
    const gate = deferred();
    const lookup = vi.spyOn(upgradeService, 'lookupUpgradeRequest');
    const posts: unknown[] = [];
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(REQUEST_C);
    wireStatus(() => status);
    server.use(
      http.post(`${API}/api/system/upgrade/requests`, async ({ request }) => {
        posts.push(await request.json());
        return HttpResponse.error();
      }),
      http.get(`${API}/api/system/upgrade/requests/:requestId`, async ({ params }) => {
        if (params['requestId'] === REQUEST_A) {
          await gate.promise;
          return HttpResponse.json(oldOperation('completed'));
        }
        return HttpResponse.json({}, { status: 404 });
      }),
    );
    const { wrapper } = queryHarness();
    const { result } = renderHook(useInstanceUpgrade, { wrapper });
    await waitFor(() => {
      expect(lookup).toHaveBeenCalledWith(REQUEST_A, undefined, true);
    });
    const oldLookup = lookup.mock.results[0]?.value;
    const completed = latestStatus();
    if (completed.confirmedServiceRelease === null) throw new Error('missing confirmed fixture');
    const confirmedA = {
      ...completed.confirmedServiceRelease,
      releaseId: '0.2.5',
      activationGeneration: 8,
      components: {
        ...completed.confirmedServiceRelease.components,
        web: {
          ...completed.confirmedServiceRelease.components.web,
          artifactDigest: DIGEST_B,
          webRevision: 'b'.repeat(40),
        },
      },
      productionWebBinding: 'instance-a/web-b',
    };
    status = {
      ...completed,
      activationGeneration: 8,
      confirmedServiceRelease: confirmedA,
      lastConfirmedServiceRelease: confirmedA,
      operation: oldOperation('completed'),
      attempt: oldAttempt('activation-confirmed'),
      availableWeb: null,
      catalog: {
        state: 'verified',
        observedAt: new Date().toISOString(),
        reason: null,
        availableRelease: {
          releaseId: '0.2.6',
          targetDigest: DIGEST_C,
          webRevision: 'c'.repeat(40),
          webArtifactDigest: DIGEST_C,
          installable: true,
          supportsAsync: true,
        },
      },
    };
    await act(async () => {
      await result.current.check();
    });
    await waitFor(() => {
      expect(result.current.busy).toBe(false);
      expect(result.current.model.canUpgrade).toBe(true);
    });
    act(() => {
      result.current.upgrade();
    });
    await waitFor(() => {
      expect(lookup).toHaveBeenCalledWith(REQUEST_C, undefined, true);
    });
    await act(async () => {
      gate.release();
      await oldLookup;
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.model.phase).toBe('pending');
    expect(result.current.model.canRefresh).toBe(false);
    expect(localStorage.getItem(key)).toContain(REQUEST_C);
    expect(result.current.observation?.snapshot?.operation).toEqual(status.operation);
    expect(posts).toEqual([
      {
        requestId: REQUEST_C,
        targetReleaseId: '0.2.6',
        targetDigest: DIGEST_C,
        expectedActivationGeneration: 8,
      },
    ]);
  });

  it('terminal A leaves a newer request C stored under the same key untouched', async () => {
    const status = latestStatus();
    const key = persist(status);
    const gate = deferred();
    const posts = wireStatus(() => status);
    const lookup = vi.spyOn(upgradeService, 'lookupUpgradeRequest');
    server.use(
      http.get(`${API}/api/system/upgrade/requests/:requestId`, async () => {
        await gate.promise;
        return HttpResponse.json(oldOperation('completed'));
      }),
    );
    const { wrapper } = queryHarness();
    const { result } = renderHook(useInstanceUpgrade, { wrapper });
    await waitFor(() => {
      expect(lookup).toHaveBeenCalled();
    });
    const pendingLookup = lookup.mock.results[0]?.value;
    persist(status, REQUEST_C);
    await act(async () => {
      gate.release();
      await pendingLookup;
    });
    await waitFor(() => {
      expect(result.current.busy).toBe(false);
    });
    expect(localStorage.getItem(key)).toContain(REQUEST_C);
    expect(result.current.model.canRefresh).toBe(true);
    expect(result.current.observation?.snapshot?.operation).toEqual(status.operation);
    expect(posts).not.toHaveBeenCalled();
  });
});
