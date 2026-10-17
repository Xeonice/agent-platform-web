import { describe, expect, it } from 'vitest';
import { deriveUpgradeModel, receiveUpgradeStatus } from '@/lib/system/upgradeModel';
import {
  attemptFixture,
  upgradeFixture,
  loadedUpgradeFixture,
  UPGRADE_TEST_TIME,
  DIGEST_A,
  DIGEST_B,
  WEB_B,
} from '@/mocks/upgrade';
import type { UpgradeOperation, UpgradeStatus } from '@/types/upgrade';

const now = Date.parse(UPGRADE_TEST_TIME);
function operation(over: Partial<UpgradeOperation> = {}): UpgradeOperation {
  return {
    instanceId: 'instance-a',
    operationId: '00000000-0000-4000-8000-000000000010',
    requestId: '00000000-0000-4000-8000-000000000002',
    sequence: 1,
    finalTargetReleaseId: '0.2.5',
    finalTargetDigest: DIGEST_B,
    state: 'running',
    acceptedAt: UPGRADE_TEST_TIME,
    observedAt: UPGRADE_TEST_TIME,
    currentStageIndex: 0,
    stages: [
      {
        releaseId: '0.2.5',
        targetDigest: DIGEST_B,
        attemptId: attemptFixture().attemptId,
        state: 'running',
      },
    ],
    percent: null,
    reason: null,
    ...over,
  };
}
const model = (status: UpgradeStatus, at = now) =>
  deriveUpgradeModel(receiveUpgradeStatus(null, status, now), loadedUpgradeFixture, at);
function completed(): UpgradeStatus {
  const status = upgradeFixture();
  if (status.confirmedServiceRelease === null) throw new Error('missing fixture');
  status.confirmedServiceRelease = {
    ...status.confirmedServiceRelease,
    releaseId: '0.2.5',
    activationGeneration: 8,
  };
  status.activationGeneration = 8;
  status.attempt = {
    ...attemptFixture(),
    state: 'activation-confirmed',
    percent: 100,
    completedWork: 100,
  };
  status.operation = operation({
    state: 'completed',
    percent: 100,
    stages: [{ ...operation().stages[0]!, state: 'confirmed' }],
  });
  return status;
}

describe('UPG optimization P01-P03/P05/P07 final-target facts', () => {
  it('does not display an earlier attempt under a newly accepted operation', () => {
    const status = completed();
    status.operation = operation({
      operationId: '00000000-0000-4000-8000-000000000011',
      state: 'accepted',
      stages: [{ releaseId: '0.2.5', targetDigest: DIGEST_B, attemptId: null, state: 'pending' }],
    });
    status.currentStageProgress = {
      stage: 'completed',
      percent: 100,
      completedWork: 100,
      totalWork: 100,
      enteredAt: UPGRADE_TEST_TIME,
      lastProgressAt: UPGRADE_TEST_TIME,
    };
    expect(model(status)).toMatchObject({ phase: 'ongoing', percent: null, canRefresh: false });
    expect(model(status).stageProgress).toBeUndefined();
  });
  it('keeps one final target after bridge confirmation and does not compare independent technical sequences', () => {
    const status = upgradeFixture();
    const bridge = {
      ...attemptFixture(),
      targetReleaseId: '0.2.4-bridge',
      targetDigest: DIGEST_A,
      state: 'activation-confirmed' as const,
      percent: 100,
      sequence: 99,
    };
    status.attempt = bridge;
    status.operation = operation({
      currentStageIndex: 1,
      stages: [
        {
          releaseId: bridge.targetReleaseId,
          targetDigest: DIGEST_A,
          attemptId: bridge.attemptId,
          state: 'confirmed',
        },
        { releaseId: '0.2.5', targetDigest: DIGEST_B, attemptId: null, state: 'pending' },
      ],
    });
    expect(model(status)).toMatchObject({ phase: 'ongoing', percent: null, canRefresh: false });
    expect(model(status).subtitle).toContain('兼容准备完成');
    const before = receiveUpgradeStatus(null, status, now);
    const next = {
      ...status,
      operation: { ...status.operation, sequence: 2 },
      attempt: {
        ...attemptFixture(),
        attemptId: '00000000-0000-4000-8000-000000000012',
        sequence: 1,
      },
    };
    next.operation.stages = [
      next.operation.stages[0]!,
      { ...next.operation.stages[1]!, attemptId: next.attempt.attemptId, state: 'running' },
    ];
    expect(receiveUpgradeStatus(before, next, now).uncertain).toBe(false);
  });
  it('shows known download work while overall work is unknown and stops elapsed display when stale', () => {
    const status = upgradeFixture();
    status.attempt = { ...attemptFixture(), percent: null, totalWork: null };
    status.operation = operation();
    status.currentStageProgress = {
      stage: 'downloading',
      completedWork: 64 * 1024 * 1024,
      totalWork: 100 * 1024 * 1024,
      percent: 64,
      enteredAt: UPGRADE_TEST_TIME,
      lastProgressAt: UPGRADE_TEST_TIME,
    };
    expect(model(status)).toMatchObject({
      phase: 'ongoing',
      percent: null,
      stageProgress: { percent: 64, workText: '64.0 MB / 100.0 MB', stale: false },
    });
    expect(model(status, now + 5001)).toMatchObject({
      phase: 'unknown',
      stageProgress: { percent: 64, stale: true },
    });
  });
  it('cannot make expired physical evidence fresh by changing the status read time', () => {
    const status = upgradeFixture();
    status.operation = operation();
    status.observation = {
      state: 'fresh',
      confirmedAt: new Date(now - 6000).toISOString(),
      checkedAt: UPGRADE_TEST_TIME,
      reason: null,
    };
    expect(model(status)).toMatchObject({
      phase: 'ongoing',
      canUpgrade: false,
      canRefresh: false,
      percent: null,
    });
    expect(model(status).facts[0]?.value).toContain('当前状态待确认');
  });
  it('rejects old or conflicting operation observations without mutating technical history', () => {
    const status = completed();
    const before = receiveUpgradeStatus(null, status, now);
    const stale = {
      ...status,
      observedAt: new Date(now + 100).toISOString(),
      operation: { ...status.operation!, sequence: 0, state: 'running' as const, percent: null },
    };
    expect(receiveUpgradeStatus(before, stale, now + 100)).toBe(before);
    expect(
      receiveUpgradeStatus(
        before,
        { ...status, operation: { ...status.operation!, finalTargetDigest: DIGEST_A } },
        now,
      ).uncertain,
    ).toBe(true);
  });
  it('separates a partial failure from current availability and gates the repair action on fresh measured state', () => {
    const status = upgradeFixture();
    status.lastConfirmedServiceRelease = status.confirmedServiceRelease;
    status.confirmedServiceRelease = null;
    status.serviceState = 'transitioning';
    status.attempt = { ...attemptFixture(), state: 'failed' };
    status.operation = operation({ state: 'failed', reason: '服务验证未通过' });
    status.serviceAvailability = {
      state: 'available',
      observedAt: UPGRADE_TEST_TIME,
      reason: null,
    };
    expect(model(status)).toMatchObject({
      phase: 'failed',
      canUpgrade: false,
      canContinueWorking: true,
    });
    expect(model(status).subtitle).not.toContain('部分组件已更新');
    status.repairableCurrent = {
      baseConfirmedReleaseId: '0.2.4',
      activationGeneration: 7,
      observedAt: UPGRADE_TEST_TIME,
    };
    expect(model(status)).toMatchObject({
      phase: 'failed',
      canUpgrade: true,
      upgradeActionLabel: '修复到 0.2.5',
    });
    expect(model(status).subtitle).toContain('部分组件已更新');
    expect(model(status).diagnosticText).not.toContain('test-only-csrf');
  });
  it('only a confirmed managed default change creates the completion scope statement', () => {
    const status = completed();
    expect(model(status).completionSummary).toBeUndefined();
    status.operation!.defaultImageUpdate = {
      scope: 'managed-default',
      observedAt: UPGRADE_TEST_TIME,
      images: [
        {
          provider: 'boxlite',
          previousRef: 'old',
          previousDigest: DIGEST_A,
          ref: 'new',
          digest: DIGEST_B,
          runtimeVersions: { codex: '0.163.0', 'claude-code': '2.1.302' },
        },
      ],
    };
    expect(model(status).completionSummary).toContain('已有任务继续原环境');
    expect(model(status).completionSummary).toContain('自定义默认');
    status.operation!.defaultImageUpdate.images[0]!.previousRef = 'new';
    status.operation!.defaultImageUpdate.images[0]!.previousDigest = DIGEST_B;
    expect(model(status).completionSummary).toBeUndefined();
    expect(model(status).canRefresh).toBe(false);
  });
  it('final completion still requires matching current production Web before offering refresh', () => {
    const status = completed();
    if (status.confirmedServiceRelease === null) throw new Error('missing fixture');
    status.confirmedServiceRelease = {
      ...status.confirmedServiceRelease,
      productionWebBinding: 'instance-a/web-b',
      components: {
        ...status.confirmedServiceRelease.components,
        web: {
          ...status.confirmedServiceRelease.components.web,
          webRevision: WEB_B,
          artifactDigest: DIGEST_B,
        },
      },
    };
    status.availableWeb = {
      releaseId: '0.2.5',
      webReleaseId: '0.2.5',
      webRevision: WEB_B,
      artifactDigest: DIGEST_B,
      instanceId: 'instance-a',
      activationGeneration: 8,
      productionBinding: 'instance-a/web-b',
      ready: true,
      compatible: true,
      observedAt: UPGRADE_TEST_TIME,
    };
    expect(model(status)).toMatchObject({ phase: 'ready', percent: 100, canRefresh: true });
    status.operation!.state = 'running';
    status.operation!.percent = null;
    expect(model(status)).toMatchObject({ phase: 'ongoing', percent: null, canRefresh: false });
  });
});
