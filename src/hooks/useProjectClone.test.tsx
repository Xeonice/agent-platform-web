// clone 进度派生补测：cloning → done / failed 分支 + 引导。
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectClone } from '@/hooks/useProjectClone';
import { useAppStore } from '@/stores';

beforeEach(() => {
  useAppStore.getState().clearCloneProgress('p1');
});

function emit(
  phase: 'cloning' | 'slow' | 'done' | 'failed',
  extra: Record<string, unknown> = {},
): void {
  useAppStore.getState().applyProjectCloneEvent({
    event: 'project.clone_progress',
    projectId: 'p1',
    phase,
    ...extra,
  });
}

describe('useProjectClone', () => {
  it('无记录 → 全 false、percent null', () => {
    const { result } = renderHook(() => useProjectClone('p1'));
    expect(result.current.state).toBeNull();
    expect(result.current.isCloning).toBe(false);
    expect(result.current.percent).toBeNull();
  });

  it('cloning 事件推进 → isCloning + percent + detailLabel（bytes）', () => {
    const { result, rerender } = renderHook(() => useProjectClone('p1'));
    act(() => {
      emit('cloning', { receivedBytes: 1024 * 1024, totalBytes: 4 * 1024 * 1024 });
    });
    rerender();
    expect(result.current.isCloning).toBe(true);
    expect(result.current.percent).toBe(25);
    expect(result.current.detailLabel).toBe('1.0 MB / 4.0 MB');
  });

  it('done 事件 → isDone', () => {
    const { result, rerender } = renderHook(() => useProjectClone('p1'));
    act(() => {
      emit('done', { percent: 100 });
    });
    rerender();
    expect(result.current.isDone).toBe(true);
  });

  it('failed(network) → isFailed + guidance 可重试', () => {
    const { result, rerender } = renderHook(() => useProjectClone('p1'));
    act(() => {
      emit('failed', { errorCode: 'CLONE_FAILED_NETWORK' });
    });
    rerender();
    expect(result.current.isFailed).toBe(true);
    expect(result.current.guidance?.canRetry).toBe(true);
    expect(result.current.guidance?.needsCredentials).toBe(false);
  });

  it('failed(permission) → 需凭证、不可重试', () => {
    const { result, rerender } = renderHook(() => useProjectClone('p1'));
    act(() => {
      emit('failed', { errorCode: 'CLONE_FAILED_PERMISSION' });
    });
    rerender();
    expect(result.current.guidance?.needsCredentials).toBe(true);
    expect(result.current.guidance?.canRetry).toBe(false);
  });
});
