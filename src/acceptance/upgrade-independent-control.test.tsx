import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  deriveUpgradeModel,
  receiveUpgradeStatus,
  unknownUpgradeObservation,
} from '@/lib/system/upgradeModel';
import {
  attemptFixture,
  DIGEST_B,
  loadedUpgradeFixture,
  upgradeFixture,
  UPGRADE_TEST_TIME,
} from '@/mocks/upgrade';
import { UpgradeStatusSchema } from '@/types/upgrade-contract';
import type { UpgradeStatus } from '@/types/upgrade';
import { VersionUpdateCardView } from '@/views/system/VersionUpdateCard.view';

const now = Date.parse(UPGRADE_TEST_TIME);
function independentStatus(): UpgradeStatus {
  return {
    ...upgradeFixture(),
    controlSystem: {
      version: 'control-1.0.0',
      protocolVersion: 1,
      state: 'ready',
      observedAt: UPGRADE_TEST_TIME,
    },
    diagnostics: {
      correlationId: 'trace-upgrade-1',
      phase: 'prepared-ready',
      code: 'UPGRADE_RPC_TIMEOUT',
      recordedAt: UPGRADE_TEST_TIME,
    },
  };
}
function recoveryStatus(): UpgradeStatus {
  const status = independentStatus();
  status.attempt = {
    ...attemptFixture(),
    state: 'activation-confirmed',
    percent: 100,
    completedWork: 100,
  };
  status.operation = {
    operationId: '00000000-0000-4000-8000-000000000010',
    requestId: status.attempt.requestId,
    instanceId: status.instanceId,
    sequence: 9,
    finalTargetReleaseId: status.attempt.targetReleaseId,
    finalTargetDigest: DIGEST_B,
    state: 'completed',
    acceptedAt: UPGRADE_TEST_TIME,
    observedAt: UPGRADE_TEST_TIME,
    currentStageIndex: 0,
    stages: [
      {
        releaseId: status.attempt.targetReleaseId,
        targetDigest: DIGEST_B,
        attemptId: status.attempt.attemptId,
        state: 'confirmed',
      },
    ],
    percent: 100,
    reason: null,
  };
  status.recovery = {
    recoveryAttemptId: '00000000-0000-4000-8000-000000000011',
    triggeringAttemptId: status.attempt.attemptId,
    triggeringOperationId: status.operation.operationId,
    generation: 1,
    sequence: 3,
    state: 'recovering',
    phase: 'verifying',
    confirmedAt: null,
    planDigest: DIGEST_B,
    reason: '验证当前服务组合',
    observedAt: UPGRADE_TEST_TIME,
    diagnosticId: 'trace-recovery-1',
  };
  status.serviceState = 'unknown';
  status.confirmedServiceRelease = null;
  return status;
}
function display(status: UpgradeStatus, at = now) {
  return deriveUpgradeModel(receiveUpgradeStatus(null, status, now), loadedUpgradeFixture, at);
}

describe('UPG independent control and recovery projections', () => {
  it('keeps the controller version out of the business release and the default update prompt', () => {
    const model = display(independentStatus());
    expect(model.facts).toContainEqual({ label: '当前服务版本', value: '0.2.4' });
    expect(model.artifactDetails).toContainEqual({
      label: '升级控制系统版本',
      value: 'control-1.0.0',
    });
    expect(model.facts.some((fact) => fact.value.includes('control-1.0.0'))).toBe(false);
    expect(model.title).toBe('发现新版本');
    expect(model.canUpgrade).toBe(true);
  });

  it('does not grant a new upgrade from stale, passive or reconciling control authority', () => {
    for (const state of ['passive', 'reconciling', 'unavailable'] as const) {
      const status = independentStatus();
      status.controlSystem = { ...status.controlSystem!, state };
      expect(display(status).canUpgrade).toBe(false);
    }
    const status = independentStatus();
    status.controlSystem!.observedAt = new Date(now - 6000).toISOString();
    expect(display(status).canUpgrade).toBe(false);
    expect(display(status).artifactDetails).toContainEqual({
      label: '升级控制状态',
      value: '独立控制已就绪 · 当前待确认',
    });
  });

  it('keeps the original completed 100% as history while recovery and current readiness are separate', () => {
    const model = display(recoveryStatus());
    expect(model).toMatchObject({
      phase: 'recovery',
      showEntry: false,
      canUpgrade: false,
      canRefresh: false,
      percent: null,
      recoverySummary: {
        stateText: '正在恢复服务',
        phaseText: '验证服务与原任务',
        confirmedAt: null,
        stale: false,
      },
    });
    expect(model.facts).toContainEqual({
      label: '本次升级结果',
      value: '最终目标曾确认完成 · 100%（历史）',
    });
  });

  it('preserves real confirmation and last-observed times on control failure without making them fresh', () => {
    const status = recoveryStatus();
    status.recovery = {
      ...status.recovery!,
      state: 'recovery-confirmed',
      phase: 'recovered',
      confirmedAt: UPGRADE_TEST_TIME,
    };
    const observation = receiveUpgradeStatus(null, status, now);
    const model = deriveUpgradeModel(
      unknownUpgradeObservation(observation),
      loadedUpgradeFixture,
      now + 10_000,
    );
    expect(model).toMatchObject({
      phase: 'unknown',
      canUpgrade: false,
      canRefresh: false,
      recoverySummary: {
        stateText: '上次记录：服务恢复已确认 · 当前状态待确认',
        confirmedAt: UPGRADE_TEST_TIME,
        lastObservedAt: UPGRADE_TEST_TIME,
        stale: true,
      },
    });
  });

  it('does not turn a new control read into a new business confirmation', () => {
    const status = independentStatus();
    const confirmedAt = new Date(now - 6000).toISOString();
    status.observation = {
      state: 'stale',
      confirmedAt,
      checkedAt: UPGRADE_TEST_TIME,
      reason: '业务状态待确认',
    };
    expect(display(status)).toMatchObject({
      phase: 'unknown',
      canUpgrade: false,
      canRefresh: false,
      lastSeenText: `上次服务确认 ${confirmedAt}`,
    });
  });

  it('rejects delayed recovery progress and conflicting confirmation records', () => {
    const status = recoveryStatus();
    status.recovery = {
      ...status.recovery!,
      state: 'recovery-confirmed',
      phase: 'recovered',
      confirmedAt: UPGRADE_TEST_TIME,
    };
    const previous = receiveUpgradeStatus(null, status, now);
    const delayed = {
      ...status,
      recovery: { ...status.recovery, state: 'recovering' as const, sequence: 2 },
    };
    expect(receiveUpgradeStatus(previous, delayed, now + 1)).toBe(previous);
    const conflicting = {
      ...status,
      recovery: {
        ...status.recovery,
        sequence: 4,
        confirmedAt: new Date(now + 1).toISOString(),
      },
    };
    expect(receiveUpgradeStatus(previous, conflicting, now + 1).uncertain).toBe(true);
  });

  it('copies only bounded diagnostic metadata and accepts the rolling legacy response', () => {
    const model = display(recoveryStatus());
    expect(model.diagnosticText).toContain('trace-upgrade-1');
    expect(model.diagnosticText).toContain('trace-recovery-1');
    expect(model.diagnosticText).not.toContain('test-only-csrf');
    expect(model.diagnosticText).not.toContain('验证当前服务组合');
    expect(UpgradeStatusSchema.parse(upgradeFixture()).controlSystem).toBeUndefined();
    const status = independentStatus();
    expect(
      UpgradeStatusSchema.safeParse({
        ...status,
        diagnostics: { ...status.diagnostics, token: 'must-never-export' },
      }).success,
    ).toBe(false);
  });

  it('shows recovery in the system card, keeps control details collapsed, and adds no upgrade permission flow', () => {
    const onCopyDiagnostics = vi.fn();
    render(
      <VersionUpdateCardView
        model={display(recoveryStatus())}
        headingRef={null}
        busy={false}
        isChecking={false}
        commandMessage={null}
        onCheck={vi.fn()}
        onUpgrade={vi.fn()}
        onRefresh={vi.fn()}
        onLater={vi.fn()}
        onDetails={vi.fn()}
        onCopyDiagnostics={onCopyDiagnostics}
      />,
    );
    const recovery = screen.getByRole('region', { name: '失败恢复' });
    expect(within(recovery).getByText('正在恢复服务')).toBeVisible();
    expect(within(recovery).getByText('恢复阶段：验证服务与原任务')).toBeVisible();
    expect(within(recovery).queryByText(/恢复确认时间/)).not.toBeInTheDocument();
    expect(screen.getByText('最终目标曾确认完成 · 100%（历史）')).toBeVisible();
    expect(screen.getByText('control-1.0.0')).not.toBeVisible();
    fireEvent.click(screen.getByText('运行产物详情'));
    expect(screen.getByText('control-1.0.0')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '复制诊断信息' }));
    expect(onCopyDiagnostics).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '立即升级' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '授权升级' })).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
