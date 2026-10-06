import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './support/server';
import { API, body, deferred, sandbox } from './support/fixtures';
import { queryHarness } from './support/mount';
import { useAppStore } from '@/stores';
import { useSandboxOperations } from '@/hooks/sandbox/useSandboxOperations';
import { useSandboxes } from '@/hooks/sandbox/useSandboxes';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const useOperation = () => useSandboxOperations('task-a', '修复首页', 'project-a');
describe('SBX · stop/start/delete HTTP lifecycle', () => {
  it('REQ-SBX-010/011: stop immediately removes waiting input, preserves identity and settles on authoritative stopped', async () => {
    const gate = deferred();
    let stopped = false;
    server.use(
      http.get(`${API}/api/sandboxes`, () =>
        HttpResponse.json([
          sandbox({ status: stopped ? 'stopped' : 'running', waitingInput: !stopped }),
        ]),
      ),
      http.post(`${API}/api/sandboxes/task-a/stop`, async () => {
        await gate.promise;
        stopped = true;
        return HttpResponse.json(sandbox({ status: 'stopped' }));
      }),
    );
    const { result } = renderHook(() => ({ ops: useOperation(), list: useSandboxes() }), {
      wrapper: queryHarness().wrapper,
    });
    await waitFor(() => {
      expect(result.current.list.data?.[0]?.waitingInput).toBe(true);
    });
    act(() => {
      result.current.ops.stop();
    });
    await waitFor(() => {
      expect(result.current.list.data?.[0]?.status).toBe('stopping');
    });
    expect(result.current.list.data?.[0]?.waitingInput).toBe(false);
    expect(result.current.list.data?.[0]?.id).toBe('task-a');
    act(gate.release);
    await waitFor(() => {
      expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('stopped');
    });
  });
  it('REQ-SBX-013: restart uses the same object/fourth startup phase and never repeats original prompt', async () => {
    const seen = vi.fn();
    useAppStore.getState().setSandboxStatus('task-a', 'stopped');
    server.use(
      http.post(`${API}/api/sandboxes/task-a/start`, async ({ request }) => {
        seen(await request.text());
        return HttpResponse.json(sandbox({ status: 'starting' }));
      }),
    );
    const { result } = renderHook(useOperation, { wrapper: queryHarness().wrapper });
    act(() => {
      result.current.start();
    });
    await waitFor(() => {
      expect(result.current.busy).toBe(false);
      expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('starting');
    });
    expect(useAppStore.getState().sandboxStatuses['task-a']?.restarting).toBe(true);
    expect(seen.mock.calls[0]?.[0]).not.toContain('initialPrompt');
  });
  it('REQ-SBX-015: concurrency 409 reads detail instead of inventing an operation failure', async () => {
    const fetched = vi.fn();
    server.use(
      http.post(`${API}/api/sandboxes/task-a/stop`, () =>
        HttpResponse.json(
          { code: 'INVALID_STATE', message: 'already stopped', retryable: false },
          { status: 409 },
        ),
      ),
      http.get(`${API}/api/sandboxes/task-a`, () => {
        fetched();
        return HttpResponse.json(sandbox({ status: 'stopped' }));
      }),
    );
    const { result } = renderHook(useOperation, { wrapper: queryHarness().wrapper });
    act(() => {
      result.current.stop();
    });
    await waitFor(() => {
      expect(fetched).toHaveBeenCalledOnce();
      expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('stopped');
    });
    expect(useAppStore.getState().sandboxStatuses['task-a']?.failureCode).toBeUndefined();
  });
  it('REQ-SBX-014: provider failure remains visible with start context and original workspace identity', async () => {
    useAppStore.getState().setSandboxStatus('task-a', 'stopped');
    server.use(
      http.post(`${API}/api/sandboxes/task-a/start`, () =>
        HttpResponse.json(
          { code: 'PROVIDER_UNAVAILABLE', message: 'provider detail', retryable: true },
          { status: 503 },
        ),
      ),
    );
    const { result } = renderHook(useOperation, { wrapper: queryHarness().wrapper });
    act(() => {
      result.current.start();
    });
    await waitFor(() => {
      expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('failed');
    });
    expect(useAppStore.getState().sandboxStatuses['task-a']).toMatchObject({
      failureCode: 'PROVIDER_UNAVAILABLE',
      failureOperation: 'start',
    });
  });
  it('REQ-SBX-020/021/022: selected delete returns to overview immediately, omits it from attention, and waits for success notice', async () => {
    const gate = deferred();
    const submitted = vi.fn();
    useAppStore.setState({ selectedProjectId: 'project-a', selectedSandboxId: 'task-a' });
    useAppStore.getState().setSandboxStatus('task-a', 'stopped');
    window.history.replaceState({}, '', '/?taskId=task-a');
    server.use(
      http.delete(`${API}/api/sandboxes/task-a`, async ({ request }) => {
        submitted(await body(request));
        await gate.promise;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(useOperation, { wrapper: queryHarness().wrapper });
    act(() => {
      void result.current.destroy(true).catch(() => undefined);
    });
    await waitFor(() => {
      expect(submitted).toHaveBeenCalledWith({ keepVolume: true });
    });
    expect(useAppStore.getState().selectedSandboxId).toBeNull();
    expect(useAppStore.getState().selectedProjectId).toBeNull();
    expect(window.location.search).toBe('');
    expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('destroying');
    expect(useAppStore.getState().workbenchNotice?.message).toContain('正在销毁');
    act(gate.release);
    await waitFor(() => {
      expect(useAppStore.getState().workbenchNotice?.message).toContain('已销毁');
    });
    expect(useAppStore.getState().workbenchNotice?.retainedProjectId).toBe('project-a');
    expect(useAppStore.getState().workbenchNotice?.description).toContain('30');
  });
  it('REQ-SBX-021: transport failure restores prior task state and never claims a freed task slot', async () => {
    useAppStore.setState({ selectedSandboxId: 'task-a', selectedProjectId: 'project-a' });
    useAppStore.getState().setSandboxStatus('task-a', 'stopped');
    server.use(http.delete(`${API}/api/sandboxes/task-a`, () => HttpResponse.error()));
    const { result } = renderHook(useOperation, { wrapper: queryHarness().wrapper });
    act(() => {
      void result.current.destroy(false).catch(() => undefined);
    });
    await waitFor(() => {
      expect(result.current.busy).toBe(false);
      expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('stopped');
    });
    expect(useAppStore.getState().workbenchNotice?.message).toContain('没能');
    expect(useAppStore.getState().workbenchNotice?.description ?? '').not.toContain('已释放');
  });
});
