import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/stores';

beforeEach(() => {
  useAppStore.getState().clearCloneProgress('p1');
});

describe('createProjectCloneSlice（clone_progress 投影 10 §7.4）', () => {
  it('setCloneProgress 种子 cloning', () => {
    useAppStore.getState().setCloneProgress('p1', { phase: 'cloning' });
    expect(useAppStore.getState().projectClones['p1']?.phase).toBe('cloning');
  });

  it('applyProjectCloneEvent 推进 cloning → done（含 percent/bytes）', () => {
    useAppStore.getState().applyProjectCloneEvent({
      event: 'project.clone_progress',
      projectId: 'p1',
      phase: 'cloning',
      percent: 30,
      receivedBytes: 300,
      totalBytes: 1000,
    });
    expect(useAppStore.getState().projectClones['p1']).toMatchObject({
      phase: 'cloning',
      percent: 30,
      receivedBytes: 300,
      totalBytes: 1000,
    });

    useAppStore.getState().applyProjectCloneEvent({
      event: 'project.clone_progress',
      projectId: 'p1',
      phase: 'done',
      percent: 100,
    });
    expect(useAppStore.getState().projectClones['p1']?.phase).toBe('done');
  });

  it('applyProjectCloneEvent 记录 failed + errorCode', () => {
    useAppStore.getState().applyProjectCloneEvent({
      event: 'project.clone_progress',
      projectId: 'p1',
      phase: 'failed',
      errorCode: 'CLONE_FAILED_NETWORK',
    });
    expect(useAppStore.getState().projectClones['p1']).toMatchObject({
      phase: 'failed',
      errorCode: 'CLONE_FAILED_NETWORK',
    });
  });

  it('非 clone_progress 事件忽略', () => {
    useAppStore.getState().setCloneProgress('p1', { phase: 'cloning' });
    useAppStore.getState().applyProjectCloneEvent({
      event: 'sandbox.status_changed',
      sandboxId: 's1',
      status: 'running',
    });
    expect(useAppStore.getState().projectClones['p1']?.phase).toBe('cloning');
  });

  it('clearCloneProgress 删除条目', () => {
    useAppStore.getState().setCloneProgress('p1', { phase: 'done' });
    useAppStore.getState().clearCloneProgress('p1');
    expect(useAppStore.getState().projectClones['p1']).toBeUndefined();
  });
});
