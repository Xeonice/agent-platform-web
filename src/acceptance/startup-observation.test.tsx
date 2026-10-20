import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './support/server';
import { mount, queryHarness } from './support/mount';
import { API, sandbox, deferred } from './support/fixtures';
import { useSandboxRestore } from '@/hooks/sandbox/useSandboxRestore';
import { useSandboxLifecycle } from '@/hooks/sandbox/useSandboxLifecycle';
import { useSandboxOperations } from '@/hooks/sandbox/useSandboxOperations';
import { useSandboxes } from '@/hooks/sandbox/useSandboxes';
import { SandboxStartupProgressView } from '@/views/sandbox/SandboxStartupProgress.view';
import { useAppStore } from '@/stores';
import { receiveStartupObservation } from '@/lib/sandbox/startupObservation';
import { instanceSubCopy } from '@/lib/sandbox/instanceStartupCopy';
import type { StartupObservation } from '@/types/ws-protocol';

const iso = (ms: number) => new Date(ms).toISOString();
function observation(over: Partial<StartupObservation> = {}): StartupObservation {
  const now = Date.now();
  return {
    operationId: 'provision-cycle-original',
    sequence: 4,
    state: 'inflight',
    stage: 'instance-start',
    startedAt: iso(now - 633000),
    stageEnteredAt: iso(now - 485000),
    lastProgressAt: iso(now - 485000),
    heartbeatAt: iso(now),
    observedAt: iso(now),
    ...over,
  };
}
function Startup() {
  useSandboxRestore('task-a', 'project-a');
  const model = useSandboxLifecycle('task-a');
  if (model.decision === 'running') return <p>原任务已就绪</p>;
  return (
    <SandboxStartupProgressView
      phases={model.phases}
      activeIndex={model.activePhaseIndex}
      percent={model.percent}
      taskName="原任务"
      headline={model.headline}
      operationFacts={model.operationFacts}
      diagnosticOperationId={model.diagnosticOperationId}
      waitingConfirmation={model.waitingConfirmation}
      phaseNote={model.phaseNote}
      activeElapsedLabel={model.elapsedLabel}
      onCheck={model.checkStartup}
      onContinue={model.continueWaiting}
    />
  );
}

describe('LCH/SBX optimization P04/P06 original startup observations', () => {
  it('an old stopped cycle cannot override a new start while its response is unresolved, including remount and list seeds', async () => {
    const old = observation({ operationId: 'old-cycle', state: 'succeeded', stage: 'completed' });
    useAppStore.getState().setSandboxStatus('task-a', 'stopped', { startupObservation: old });
    const gate = deferred();
    const commands = vi.fn();
    server.use(
      http.post(`${API}/api/sandboxes/task-a/start`, async () => {
        commands();
        await gate.promise;
        return HttpResponse.json(
          sandbox({
            status: 'starting',
            startupObservation: observation({ operationId: 'new-cycle', sequence: 0 }),
          }),
        );
      }),
      http.get(`${API}/api/sandboxes/task-a`, () =>
        HttpResponse.json(sandbox({ status: 'stopped', startupObservation: old })),
      ),
      http.get(`${API}/api/sandboxes`, () =>
        HttpResponse.json([sandbox({ status: 'stopped', startupObservation: old })]),
      ),
    );
    const { result } = renderHook(() => useSandboxOperations('task-a', '原任务', 'project-a'), {
      wrapper: queryHarness().wrapper,
    });
    act(() => {
      result.current.start();
    });
    await waitFor(() => {
      expect(commands).toHaveBeenCalledOnce();
    });
    const first = renderHook(
      () => ({ restore: useSandboxRestore('task-a', 'project-a'), list: useSandboxes() }),
      { wrapper: queryHarness().wrapper },
    );
    await waitFor(() => {
      expect(first.result.current.restore.isPending).toBe(false);
      expect(first.result.current.list.isSuccess).toBe(true);
    });
    expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('starting');
    first.unmount();
    const next = renderHook(() => useSandboxRestore('task-a', 'project-a'), {
      wrapper: queryHarness().wrapper,
    });
    await waitFor(() => {
      expect(next.result.current.isPending).toBe(false);
    });
    expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('starting');
    expect(commands).toHaveBeenCalledOnce();
    next.unmount();
    act(gate.release);
    await waitFor(() => {
      expect(result.current.busy).toBe(false);
    });
  });
  it('an unresolved stop is read again without a WebSocket event until the original stop confirms', async () => {
    useAppStore.getState().setSandboxStatus('task-a', 'running');
    let stopped = false;
    const commands = vi.fn();
    const reads = vi.fn();
    server.use(
      http.post(`${API}/api/sandboxes/task-a/stop`, () => {
        commands();
        return HttpResponse.json(
          { code: 'TIMEOUT', message: 'waiting', retryable: true },
          { status: 504 },
        );
      }),
      http.get(`${API}/api/sandboxes/task-a`, () => {
        reads();
        return HttpResponse.json(sandbox({ status: stopped ? 'stopped' : 'stopping' }));
      }),
    );
    const { result } = renderHook(
      () => ({
        ops: useSandboxOperations('task-a', '原任务', 'project-a'),
        restore: useSandboxRestore('task-a', 'project-a'),
      }),
      { wrapper: queryHarness().wrapper },
    );
    act(() => {
      result.current.ops.stop();
    });
    await waitFor(() => {
      expect(result.current.ops.busy).toBe(false);
      expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('stopping');
    });
    stopped = true;
    await waitFor(
      () => {
        expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('stopped');
      },
      { timeout: 4000 },
    );
    expect(commands).toHaveBeenCalledOnce();
    expect(reads.mock.calls.length).toBeGreaterThan(1);
  });
  it('restores server times, keeps the same startup after waiting, and only reads on check until delayed success', async () => {
    const original = observation();
    let complete = false;
    const writes = vi.fn();
    const reads = vi.fn();
    server.use(
      http.get(`${API}/api/sandboxes/task-a`, () => {
        reads();
        return HttpResponse.json(
          sandbox({
            status: complete ? 'running' : 'starting',
            hasRun: false,
            startupObservation: complete
              ? {
                  ...original,
                  sequence: 5,
                  state: 'succeeded',
                  stage: 'completed',
                  observedAt: iso(Date.now()),
                }
              : original,
          }),
        );
      }),
      http.post(`${API}/api/sandboxes/:id/start`, () => {
        writes();
        return HttpResponse.error();
      }),
      http.post(`${API}/api/sandboxes`, () => {
        writes();
        return HttpResponse.error();
      }),
    );
    const mounted = mount(<Startup />);
    await screen.findByRole('heading', { name: '启动请求仍在执行，正在确认结果' });
    expect(screen.getByRole('progressbar', { name: '任务启动总体进度' })).not.toHaveAttribute(
      'aria-valuenow',
    );
    expect(screen.getByText('10:33')).toBeInTheDocument();
    expect(screen.queryByText('provision-cycle-original', { exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '继续等待' }));
    const after = useAppStore.getState().sandboxStatuses['task-a']?.startupObservation;
    expect(after).toMatchObject({
      operationId: original.operationId,
      startedAt: original.startedAt,
      stageEnteredAt: original.stageEnteredAt,
      lastProgressAt: original.lastProgressAt,
    });
    mounted.unmount();
    mount(<Startup />);
    await screen.findByRole('heading', { name: '启动请求仍在执行，正在确认结果' });
    complete = true;
    fireEvent.click(screen.getByRole('button', { name: '检查状态' }));
    await screen.findByText('原任务已就绪');
    expect(reads.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(writes).not.toHaveBeenCalled();
  });
  it('an old or missing heartbeat does not claim that the operation is currently executing', () => {
    const original = observation({ heartbeatAt: null });
    useAppStore.getState().setSandboxStatus('task-a', 'starting', { startupObservation: original });
    const { result } = renderHook(() => useSandboxLifecycle('task-a'), {
      wrapper: queryHarness().wrapper,
    });
    expect(result.current.headline).toBe('正在确认原启动请求的结果');
    expect(result.current.operationFacts?.find((f) => f.label === '原启动请求')?.value).toBe(
      '已受理，结果待确认',
    );
    expect(result.current.percent).toBeNull();
  });
  it('query reads and heartbeats do not replace the real last progress clock', () => {
    const original = observation();
    const read = { ...original, observedAt: iso(Date.now() + 1000) };
    expect(receiveStartupObservation(original, read)).toMatchObject({
      uncertain: false,
      observation: { lastProgressAt: original.lastProgressAt },
    });
    const heartbeat = { ...read, sequence: 5, heartbeatAt: iso(Date.now() + 1000) };
    expect(receiveStartupObservation(original, heartbeat).observation?.lastProgressAt).toBe(
      original.lastProgressAt,
    );
    expect(receiveStartupObservation(heartbeat, original).ignored).toBe(true);
    expect(
      receiveStartupObservation(original, { ...original, stage: 'agent-bootstrap' }).uncertain,
    ).toBe(true);
  });
  it('late REST or WS progress cannot move the original cycle back to an older stage', () => {
    const original = observation();
    const store = useAppStore.getState();
    store.setSandboxStatus('task-a', 'starting', { startupObservation: original });
    act(() => {
      store.applySandboxEvent({
        event: 'sandbox.instance_progress',
        sandboxId: 'task-a',
        phase: 'starting',
        startupObservation: { ...original, sequence: 5, stage: 'environment-initialization' },
      });
    });
    act(() => {
      store.setSandboxStatus('task-a', 'starting', { startupObservation: original });
    });
    expect(useAppStore.getState().sandboxStatuses['task-a']?.startupObservation).toMatchObject({
      sequence: 5,
      stage: 'environment-initialization',
    });
    expect(instanceSubCopy({ phase: 'starting', imageStaged: false })).not.toMatch(
      /不是卡死|正在下载|网络/,
    );
  });
  it('legacy startup remains unknown without inventing a timer or a measured whole percent', () => {
    useAppStore.getState().setSandboxStatus('task-a', 'starting');
    const { result } = renderHook(() => useSandboxLifecycle('task-a'), {
      wrapper: queryHarness().wrapper,
    });
    expect(result.current.elapsedLabel).toBeUndefined();
    expect(result.current.percent).toBeNull();
    expect(result.current.operationFacts).toBeUndefined();
  });
});
