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

  it('cloning 事件推进 → isCloning + percent + 明细行拼出 git 给的全部信息', () => {
    const { result, rerender } = renderHook(() => useProjectClone('p1'));
    act(() => {
      emit('cloning', {
        stage: 'receiving',
        objectsDone: 527,
        objectsTotal: 26348,
        receivedBytes: 380 * 1024,
        bytesPerSecond: 189 * 1024,
      });
    });
    rerender();
    expect(result.current.isCloning).toBe(true);
    expect(result.current.percent).toBe(2); // 527/26348 —— 分母是对象数
    expect(result.current.detailLabel).toBe('接收对象 · 527/26,348 · 380.0 KB · 189.0 KB/s');
  });

  it('⚠️ 上一版这条测的是一条生产不可达的分支', () => {
    // 旧断言是 detailLabel === '1.0 MB / 4.0 MB'，走 `receivedBytes && totalBytes`。
    // 但 git clone **不报总字节数**，后端从来没发过 totalBytes——那条分支只有靠
    // 手工构造 state 才进得去，测绿了也证明不了任何线上行为。这里钉住新口径：
    // 没有对象数就没有百分比，明细行也不能凭空造分母。
    const { result, rerender } = renderHook(() => useProjectClone('p1'));
    act(() => {
      emit('cloning', { stage: 'receiving', receivedBytes: 1024 * 1024 });
    });
    rerender();
    expect(result.current.percent).toBeNull();
    expect(result.current.detailLabel).toBe('接收对象 · 1.0 MB');
  });

  it('receiving 之前的空窗也有话说（旧解析器这里一个数都没有）', () => {
    const { result, rerender } = renderHook(() => useProjectClone('p1'));
    act(() => {
      emit('cloning', { stage: 'enumerating', objectsTotal: 26348 });
    });
    rerender();
    expect(result.current.detailLabel).toBe('枚举远端对象 · 共 26,348 个对象');
  });

  it('已用时长只在进行中给；done/failed 后不再计时', () => {
    const { result, rerender } = renderHook(() => useProjectClone('p1'));
    act(() => {
      emit('cloning', { stage: 'receiving', objectsDone: 1, objectsTotal: 10 });
    });
    rerender();
    expect(result.current.elapsedLabel).toMatch(/^已用 \d+:\d{2}$/);
    act(() => {
      emit('done', {});
    });
    rerender();
    expect(result.current.elapsedLabel).toBeUndefined();
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
