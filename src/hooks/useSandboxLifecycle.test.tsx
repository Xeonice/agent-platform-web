// 生命周期决策补测：容器据 decision 从"启动中"切到终端（running），失败可重试。
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSandboxLifecycle } from '@/hooks/useSandboxLifecycle';
import { useAppStore } from '@/stores';

beforeEach(() => {
  useAppStore.getState().clearSandboxStatus('s1');
});

describe('useSandboxLifecycle', () => {
  it('无记录时兜底 startup（create 已发、事件未到）', () => {
    const { result } = renderHook(() => useSandboxLifecycle('s1'));
    expect(result.current.decision).toBe('startup');
    expect(result.current.activePhaseIndex).toBe(0);
  });

  it('随 status 从 startup 推进到 running（容器据此切到终端）', () => {
    const { result, rerender } = renderHook(() => useSandboxLifecycle('s1'));

    act(() => {
      useAppStore.getState().setSandboxStatus('s1', 'creating');
    });
    rerender();
    expect(result.current.decision).toBe('startup');
    expect(result.current.activePhaseIndex).toBe(2);
    expect(result.current.percent).toBe(60);

    act(() => {
      useAppStore.getState().applySandboxEvent({
        event: 'sandbox.status_changed',
        sandboxId: 's1',
        status: 'running',
      });
    });
    rerender();
    expect(result.current.decision).toBe('running');
  });

  it('failed → failed 决策（容器展示重试）', () => {
    const { result, rerender } = renderHook(() => useSandboxLifecycle('s1'));
    act(() => {
      useAppStore.getState().setSandboxStatus('s1', 'failed');
    });
    rerender();
    expect(result.current.decision).toBe('failed');
    expect(result.current.status).toBe('failed');
  });

  it('sandboxId 为 null → startup 兜底且不读表', () => {
    const { result } = renderHook(() => useSandboxLifecycle(null));
    expect(result.current.decision).toBe('startup');
    expect(result.current.status).toBeNull();
  });
});
