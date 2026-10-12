import { describe, expect, it } from 'vitest';
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
  WEB_B,
} from '@/mocks/upgrade';
import { UpgradeStatusSchema } from '@/types/upgrade-contract';
import {
  encodeDismissal,
  localNaturalDate,
  readDismissal,
  upgradeReminderKey,
} from '@/lib/system/upgradeReminderPreference';
import { newUpgradeRequestId, readPendingRequest } from '@/lib/system/upgradeRequestIdentity';
import type { UpgradeStatus } from '@/types/upgrade';
const now = Date.parse(UPGRADE_TEST_TIME);
const model = (status: UpgradeStatus) =>
  deriveUpgradeModel(
    receiveUpgradeStatus(null, UpgradeStatusSchema.parse(status), now),
    loadedUpgradeFixture,
    now,
  );
function installed(): UpgradeStatus {
  const status = upgradeFixture();
  const original = status.confirmedServiceRelease;
  if (original === null) throw new Error('fixture release missing');
  const confirmed = {
    ...original,
    releaseId: '0.2.5',
    activationGeneration: 8,
    productionWebBinding: 'instance-a/web-b',
    components: {
      ...original.components,
      web: { ...original.components.web, webRevision: WEB_B, artifactDigest: DIGEST_B },
    },
  };
  return {
    ...status,
    activationGeneration: 8,
    confirmedServiceRelease: confirmed,
    attempt: {
      ...attemptFixture(),
      state: 'activation-confirmed',
      percent: 100,
      completedWork: 100,
      sequence: 10,
    },
    availableWeb: {
      releaseId: '0.2.5',
      webReleaseId: '0.2.5',
      instanceId: 'instance-a',
      webRevision: WEB_B,
      artifactDigest: DIGEST_B,
      activationGeneration: 8,
      productionBinding: 'instance-a/web-b',
      ready: true,
      compatible: true,
      observedAt: UPGRADE_TEST_TIME,
    },
  };
}
describe('UPG F01/F03/C02 canonical version observations', () => {
  it('explains an unqualified global schema change without claiming deployment, progress or task continuity', () => {
    const status = upgradeFixture();
    status.catalog = {
      ...status.catalog,
      state: 'unavailable',
      reason: 'GLOBAL_SCHEMA_MIGRATION_UNQUALIFIED',
      availableRelease: null,
    };
    const derived = model(status);
    expect(derived).toMatchObject({
      phase: 'unknown',
      showEntry: false,
      showDot: false,
      canUpgrade: false,
      canRefresh: false,
      percent: null,
    });
    expect(derived.subtitle).toContain('数据结构变更尚未具备连续升级验证');
    expect(derived.subtitle).toContain('实例未应用该步骤');
    expect(derived.subtitle).toContain('兼容桥或独立维护方案');
    expect(derived.subtitle).not.toContain('任务');
  });
  it('only a fresh server-measured partial tuple permits a new authorized attempt from the system card, keeping historical version and failed target quiet', () => {
    const status = upgradeFixture();
    status.attempt = { ...attemptFixture(), state: 'deferred', reason: 'candidate unavailable' };
    status.lastConfirmedServiceRelease = status.confirmedServiceRelease;
    status.confirmedServiceRelease = null;
    status.serviceState = 'transitioning';
    status.capabilities.canUpgradeInstance = true;
    expect(model(status).canUpgrade).toBe(false);
    status.repairableCurrent = {
      baseConfirmedReleaseId: status.lastConfirmedServiceRelease!.releaseId,
      activationGeneration: status.activationGeneration,
      observedAt: UPGRADE_TEST_TIME,
    };
    expect(model(status)).toMatchObject({
      phase: 'failed',
      canUpgrade: true,
      showEntry: false,
      showDot: false,
      canRefresh: false,
    });
    expect(model(status).facts[0]?.value).toContain('上次完整版本');
    expect(model(status).artifactDetails[0]?.label).toBe('上次完整 API 构建');
    status.capabilities.canUpgradeInstance = false;
    expect(model(status).canUpgrade).toBe(false);
  });
  it.each(['generation', 'history', 'stale', 'future'] as const)(
    'rejects an unconfirmed partial repair fact with %s mismatch',
    (kind) => {
      const status = upgradeFixture();
      status.attempt = { ...attemptFixture(), state: 'deferred' };
      status.lastConfirmedServiceRelease = status.confirmedServiceRelease;
      status.confirmedServiceRelease = null;
      status.serviceState = 'unknown';
      status.capabilities.canUpgradeInstance = true;
      status.repairableCurrent = {
        baseConfirmedReleaseId: status.lastConfirmedServiceRelease!.releaseId,
        activationGeneration: status.activationGeneration,
        observedAt: UPGRADE_TEST_TIME,
      };
      if (kind === 'generation') status.repairableCurrent.activationGeneration++;
      if (kind === 'history') status.repairableCurrent.baseConfirmedReleaseId = '9.9.9';
      if (kind === 'stale')
        status.repairableCurrent.observedAt = new Date(now - 120000).toISOString();
      if (kind === 'future')
        status.repairableCurrent.observedAt = new Date(now + 120000).toISOString();
      expect(model(status).canUpgrade).toBe(false);
    },
  );
  it('a qualified explicit repair can proceed after unknown recovery, while an active recovery still cannot accept another attempt', () => {
    const status = upgradeFixture();
    status.attempt = { ...attemptFixture(), state: 'failed' };
    status.lastConfirmedServiceRelease = status.confirmedServiceRelease;
    status.confirmedServiceRelease = null;
    status.serviceState = 'unknown';
    status.capabilities.canUpgradeInstance = true;
    status.repairableCurrent = {
      baseConfirmedReleaseId: status.lastConfirmedServiceRelease!.releaseId,
      activationGeneration: status.activationGeneration,
      observedAt: UPGRADE_TEST_TIME,
    };
    status.recovery = {
      recoveryAttemptId: 'a0000000-0000-4000-8000-000000000000',
      triggeringAttemptId: status.attempt.attemptId,
      generation: status.activationGeneration + 1,
      sequence: 0,
      state: 'unknown',
      planDigest: DIGEST_B,
      reason: 'previous result unknown',
      observedAt: UPGRADE_TEST_TIME,
    };
    expect(model(status)).toMatchObject({ canUpgrade: true, showEntry: false });
    status.recovery.state = 'recovering';
    expect(model(status).canUpgrade).toBe(false);
  });
  it('shows available to a read-only viewer without treating catalog publication as deployment', () => {
    expect(model(upgradeFixture())).toMatchObject({
      phase: 'available',
      showEntry: true,
      showDot: true,
      canUpgrade: false,
      canRefresh: false,
      percent: null,
    });
    const status = upgradeFixture();
    status.capabilities.canUpgradeInstance = true;
    expect(model(status).canUpgrade).toBe(true);
    const available = status.catalog.availableRelease;
    if (available === null) throw new Error('missing catalog');
    available.webRevision = loadedUpgradeFixture.webRevision ?? '';
    expect(model(status).showEntry).toBe(true); // same Web still has a newer service release
  });
  it('never calls API activation or staging ready100', () => {
    const status = upgradeFixture();
    status.attempt = {
      ...attemptFixture(),
      state: 'api-activated',
      percent: 95,
      completedWork: 95,
    };
    expect(model(status)).toMatchObject({
      phase: 'ongoing',
      showDot: false,
      percent: 95,
      canRefresh: false,
    });
    status.attempt.percent = 100;
    expect(model(status)).toMatchObject({ phase: 'ongoing', percent: null, canRefresh: false });
  });
  it('separates loaded Web identity from source SHA and requires the instance actual binding', () => {
    const status = installed();
    expect(model(status)).toMatchObject({ phase: 'ready', percent: 100, canRefresh: true });
    if (status.availableWeb === null) throw new Error('missing Web');
    status.availableWeb.instanceId = 'other-instance';
    expect(model(status).canRefresh).toBe(false);
    status.availableWeb.instanceId = 'instance-a';
    expect(
      deriveUpgradeModel(
        receiveUpgradeStatus(null, status, now),
        { ...loadedUpgradeFixture, webRevision: WEB_B },
        now,
      ),
    ).toMatchObject({ showEntry: false, canRefresh: false, percent: 100 });
  });
  it('a lost production Web readiness never says an old page needs no refresh', () => {
    const status = installed();
    if (status.availableWeb === null) throw new Error('missing Web');
    status.availableWeb.observedAt = '2026-10-12T03:59:00.000Z';
    const stale = model(status);
    expect(stale.showEntry).toBe(false);
    expect(stale.canRefresh).toBe(false);
    expect(stale.subtitle).not.toContain('无需刷新');
  });
  it('same-target failure stays quiet but a new attempt remains an explicit system-card action', () => {
    const status = upgradeFixture();
    status.capabilities.canUpgradeInstance = true;
    status.attempt = { ...attemptFixture(), state: 'failed', reason: '候选服务未通过检查' };
    expect(model(status)).toMatchObject({
      phase: 'failed',
      showEntry: false,
      showDot: false,
      canUpgrade: true,
      percent: null,
    });
  });
  it('rejects late sequences, target conflicts and false progress regression without smoothing the value', () => {
    const status = upgradeFixture();
    status.attempt = { ...attemptFixture(), sequence: 3, percent: 45, completedWork: 45 };
    const previous = receiveUpgradeStatus(null, status, now);
    expect(
      receiveUpgradeStatus(
        previous,
        { ...status, attempt: { ...status.attempt, sequence: 2 } },
        now + 100,
      ),
    ).toBe(previous);
    const conflict = receiveUpgradeStatus(
      previous,
      {
        ...status,
        attempt: { ...status.attempt, sequence: 4, targetDigest: `sha256:${'c'.repeat(64)}` },
      },
      now + 100,
    );
    expect(deriveUpgradeModel(conflict, loadedUpgradeFixture, now + 100)).toMatchObject({
      phase: 'unknown',
      showEntry: false,
    });
    const regression = receiveUpgradeStatus(
      previous,
      { ...status, attempt: { ...status.attempt, sequence: 4, completedWork: 20, percent: 20 } },
      now + 100,
    );
    expect(regression.uncertain).toBe(true);
  });
  it('an independent new attempt may restart at zero but cannot inherit old recovery or completion', () => {
    const status = installed();
    const previous = receiveUpgradeStatus(null, status, now);
    const next = {
      ...status,
      attempt: {
        ...attemptFixture(),
        attemptId: '00000000-0000-4000-8000-000000000003',
        generation: 9,
        percent: 0,
        completedWork: 0,
      },
    };
    expect(
      deriveUpgradeModel(receiveUpgradeStatus(previous, next, now), loadedUpgradeFixture, now),
    ).toMatchObject({ phase: 'ongoing', percent: 0 });
  });
  it('revokes readiness without rewriting historical confirmed100 and does not revive it from a late frame', () => {
    const status = installed();
    const previous = receiveUpgradeStatus(null, status, now);
    const recovering = {
      ...status,
      availableWeb: null,
      recovery: {
        recoveryAttemptId: '00000000-0000-4000-8000-000000000004',
        triggeringAttemptId: status.attempt?.attemptId ?? '',
        generation: 9,
        sequence: 1,
        state: 'recovering' as const,
        planDigest: DIGEST_B,
        reason: '安全回退中',
        observedAt: UPGRADE_TEST_TIME,
      },
    };
    const revoked = receiveUpgradeStatus(previous, recovering, now + 100);
    expect(deriveUpgradeModel(revoked, loadedUpgradeFixture, now + 100)).toMatchObject({
      phase: 'recovery',
      showEntry: false,
      canRefresh: false,
      percent: null,
    });
    expect(revoked.snapshot?.attempt?.percent).toBe(100);
    expect(receiveUpgradeStatus(revoked, status, now + 200)).toBe(revoked);
  });
  it('retains last observed facts on a lost/stale source without reporting latest or ready', () => {
    const observation = receiveUpgradeStatus(null, installed(), now);
    expect(
      deriveUpgradeModel(unknownUpgradeObservation(observation), loadedUpgradeFixture, now),
    ).toMatchObject({ phase: 'unknown', showEntry: false, canRefresh: false });
    expect(deriveUpgradeModel(observation, loadedUpgradeFixture, now + 5001)).toMatchObject({
      phase: 'unknown',
      percent: null,
    });
    const status = upgradeFixture();
    status.attempt = attemptFixture();
    status.attempt.observedAt = '2026-10-12T03:59:00.000Z';
    expect(model(status)).toMatchObject({
      phase: 'ongoing',
      percent: null,
      progressText: '等待进度确认',
    });
  });
});
describe('UPG F02/F06 noncredential preferences', () => {
  it('uses local natural dates and isolates instance plus viewer, not target revision', () => {
    expect(localNaturalDate(new Date(2026, 9, 12, 23, 59))).toBe('2026-10-12');
    expect(localNaturalDate(new Date(2026, 9, 13, 0, 0))).toBe('2026-10-13');
    expect(readDismissal(encodeDismissal('2026-10-12'))).toBe('2026-10-12');
    expect(readDismissal('{"version":1,"dismissedLocalDate":"2026-99-99"}')).toBeNull();
    expect(upgradeReminderKey('instance-a', 'viewer-a')).not.toBe(
      upgradeReminderKey('instance-b', 'viewer-a'),
    );
    expect(upgradeReminderKey('instance-a', 'viewer-a')).not.toBe(
      upgradeReminderKey('instance-a', 'viewer-b'),
    );
  });
  it('retains only the original request identity for timeout lookup', () => {
    const requestId = newUpgradeRequestId();
    expect(readPendingRequest(JSON.stringify({ version: 1, requestId }))).toBe(requestId);
    expect(readPendingRequest('{"version":1,"requestId":"not-a-uuid"}')).toBeNull();
  });
});
