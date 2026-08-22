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
    // creating → 展示第 2 格「拉取镜像」（展示序 ≠ 状态机序，P20 §3.3 / F21-2 §6）。
    expect(result.current.activePhaseIndex).toBe(1);
    expect(result.current.phases[result.current.activePhaseIndex]?.label).toBe('拉取镜像');
    // 百分比按技术推进序算，不随展示格倒退。
    expect(result.current.percent).toBe(60);

    act(() => {
      useAppStore.getState().setSandboxStatus('s1', 'preparing-workspace');
    });
    rerender();
    expect(result.current.phases[result.current.activePhaseIndex]?.label).toBe('准备工作区');
    expect(result.current.percent).toBe(40);

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

  it('failed → failed 决策 + 人话呈现（P22 §1：不裸抛错误码）', () => {
    const { result, rerender } = renderHook(() => useSandboxLifecycle('s1'));
    act(() => {
      useAppStore.getState().setSandboxStatus('s1', 'failed');
    });
    rerender();
    expect(result.current.decision).toBe('failed');
    expect(result.current.status).toBe('failed');
    // 拿不到错误码也必须有人话 + 可点动作。
    expect(result.current.outcome?.title).toBeTruthy();
    expect(result.current.outcome?.actions.length).toBeGreaterThan(0);
  });

  it('装 CLI 进度 → 「启动实例」格下的子文案（不改 status、不 patch Query）', () => {
    const { result, rerender } = renderHook(() => useSandboxLifecycle('s1'));
    act(() => {
      useAppStore.getState().setSandboxStatus('s1', 'starting');
      useAppStore.getState().applySandboxEvent({
        event: 'runtime.install_progress',
        sandboxId: 's1',
        runtime: 'claude-code',
        status: 'installing',
      });
    });
    rerender();
    expect(result.current.status).toBe('starting');
    expect(result.current.phaseNote?.phaseKey).toBe('instance');
    expect(result.current.phaseNote?.text).toContain('正在安装 claude-code');
  });

  it('通道①ㆍINSTALL_FAILED：install_progress 的 failed 不改判定，权威码来自 status_changed', () => {
    const { result, rerender } = renderHook(() => useSandboxLifecycle('s1'));
    act(() => {
      useAppStore.getState().applySandboxEvent({
        event: 'runtime.install_progress',
        sandboxId: 's1',
        runtime: 'claude-code',
        status: 'failed',
        errorCode: 'INSTALL_FAILED',
      });
    });
    rerender();
    // install 的 failed 本身既不改判定（仍在 startup）、也不产出失败呈现（不是兜底通道，10 §3.1）。
    expect(result.current.decision).toBe('startup');
    expect(result.current.outcome).toBeNull();

    act(() => {
      useAppStore.getState().applySandboxEvent({
        event: 'sandbox.status_changed',
        sandboxId: 's1',
        status: 'failed',
        errorCode: 'INSTALL_FAILED',
      });
    });
    rerender();
    expect(result.current.decision).toBe('failed');
    expect(result.current.outcome?.code).toBe('INSTALL_FAILED');
    expect(result.current.outcome?.title).toContain('运行时 CLI 安装失败');
    expect(result.current.outcome?.actions.map((a) => a.key)).toContain('retry');
    // 装 CLI 子文案在转 failed 时被清掉，不与失败卡并存（两处同时喊失败）。
    expect(result.current.phaseNote).toBeUndefined();
  });

  it('通道①ㆍIMAGE_CONTRACT_VIOLATION（WS 即时）→ 缺 tmux 人话，且不给 [重试]', () => {
    const { result, rerender } = renderHook(() => useSandboxLifecycle('s1'));
    act(() => {
      useAppStore.getState().applySandboxEvent({
        event: 'sandbox.status_changed',
        sandboxId: 's1',
        status: 'failed',
        errorCode: 'IMAGE_CONTRACT_VIOLATION',
      });
    });
    rerender();
    expect(result.current.outcome?.title).toContain('缺少 tmux');
    expect(result.current.outcome?.actions.map((a) => a.key)).not.toContain('retry');
  });

  it('通道②ㆍDTO 种子（刷新恢复）→ 同一份人话；failureMessage 只作排障细节、不参与判定', () => {
    const { result, rerender } = renderHook(() => useSandboxLifecycle('s1'));
    act(() => {
      // 刷新后没有任何 WS 事件，只有 GET /api/sandboxes/:id 的 DTO 种子。
      useAppStore.getState().setSandboxStatus('s1', 'failed', {
        failureCode: 'IMAGE_CONTRACT_VIOLATION',
        failureMessage: 'INSTALL_FAILED-looking free text: command -v tmux exited 1',
      });
    });
    rerender();
    expect(result.current.decision).toBe('failed');
    // 码决定人话；即便自由文本里出现了别的码样字符串，也不能影响判定（禁止 parse message）。
    expect(result.current.outcome?.code).toBe('IMAGE_CONTRACT_VIOLATION');
    expect(result.current.outcome?.title).toContain('缺少 tmux');
    expect(result.current.outcome?.detail).toContain('command -v tmux exited 1');
  });

  it('ended 与 failed 分开呈现', () => {
    const { result, rerender } = renderHook(() => useSandboxLifecycle('s1'));
    act(() => {
      useAppStore.getState().setSandboxStatus('s1', 'stopped');
    });
    rerender();
    expect(result.current.decision).toBe('ended');
    expect(result.current.outcome?.code).toBe('ENDED');
  });

  it('sandboxId 为 null → startup 兜底且不读表', () => {
    const { result } = renderHook(() => useSandboxLifecycle(null));
    expect(result.current.decision).toBe('startup');
    expect(result.current.status).toBeNull();
  });
});
