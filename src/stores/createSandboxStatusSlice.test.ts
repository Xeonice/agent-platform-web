import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/stores';

beforeEach(() => {
  useAppStore.getState().clearSandboxStatus('sb1');
  useAppStore.getState().clearSandboxStatus('sb2');
});

describe('createSandboxStatusSlice（/events 投影 10 §7.4）', () => {
  it('setSandboxStatus 种子首值', () => {
    useAppStore.getState().setSandboxStatus('sb1', 'pending');
    expect(useAppStore.getState().sandboxStatuses['sb1']).toEqual({
      status: 'pending',
      phase: undefined,
    });
  });

  it('applySandboxEvent(status_changed) 更新 status/phase', () => {
    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.status_changed',
      sandboxId: 'sb1',
      status: 'creating',
      phase: 'image-pull',
    });
    expect(useAppStore.getState().sandboxStatuses['sb1']).toEqual({
      status: 'creating',
      phase: 'image-pull',
    });
  });

  it('sandbox.created 落 pending 占位，不覆盖已有', () => {
    useAppStore.getState().setSandboxStatus('sb1', 'running');
    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.created',
      sandboxId: 'sb1',
      projectId: 'p1',
    });
    expect(useAppStore.getState().sandboxStatuses['sb1']?.status).toBe('running');

    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.created',
      sandboxId: 'sb2',
      projectId: 'p1',
    });
    expect(useAppStore.getState().sandboxStatuses['sb2']?.status).toBe('pending');
  });

  it('sandbox.removed 删除条目', () => {
    useAppStore.getState().setSandboxStatus('sb1', 'running');
    useAppStore.getState().applySandboxEvent({ event: 'sandbox.removed', sandboxId: 'sb1' });
    expect(useAppStore.getState().sandboxStatuses['sb1']).toBeUndefined();
  });

  it('无关事件（waiting_input）不改动状态表', () => {
    useAppStore.getState().setSandboxStatus('sb1', 'running');
    useAppStore.getState().applySandboxEvent({
      event: 'sandbox.waiting_input',
      sandboxId: 'sb1',
      waiting: true,
    });
    expect(useAppStore.getState().sandboxStatuses['sb1']?.status).toBe('running');
  });
});
