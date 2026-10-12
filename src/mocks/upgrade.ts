import type { UpgradeStatus, UpgradeAttempt, LoadedWebBuild } from '@/types/upgrade';

/** Test/dev fixtures use the canonical controller closed sets; never a production source. */
export const UPGRADE_TEST_TIME = '2026-10-12T04:00:00.000Z';
export const WEB_A = 'a'.repeat(40);
export const WEB_B = 'b'.repeat(40);
export const DIGEST_A = `sha256:${'a'.repeat(64)}`;
export const DIGEST_B = `sha256:${'b'.repeat(64)}`;
export const loadedUpgradeFixture: LoadedWebBuild = {
  webRevision: WEB_A,
  releaseId: '0.2.4',
  builtAt: UPGRADE_TEST_TIME,
};
export function upgradeFixture(): UpgradeStatus {
  const artifact = {
    artifactDigest: DIGEST_A,
    inputFingerprint: DIGEST_A,
    sourceRevision: WEB_A,
    protocol: { min: 4, max: 5 },
  };
  const confirmed = {
    releaseId: '0.2.4',
    activationGeneration: 7,
    activatedAt: UPGRADE_TEST_TIME,
    schema: 1,
    channel: 'stable',
    components: { api: artifact, web: { ...artifact, webRevision: WEB_A }, installer: artifact },
    commits: { project: WEB_A, api: WEB_A, web: WEB_A },
    productionWebBinding: 'instance-a/web-a',
  };
  return {
    instanceId: 'instance-a',
    userScope: 'viewer-a',
    activationGeneration: 7,
    confirmedServiceRelease: confirmed,
    lastConfirmedServiceRelease: confirmed,
    serviceState: 'confirmed',
    catalog: {
      state: 'verified',
      observedAt: UPGRADE_TEST_TIME,
      reason: null,
      availableRelease: {
        releaseId: '0.2.5',
        targetDigest: DIGEST_B,
        webRevision: WEB_B,
        webArtifactDigest: DIGEST_B,
        installable: true,
      },
    },
    capabilities: { canUpgradeInstance: false, canAuthenticate: true },
    csrfToken: 'test-only-csrf',
    attempt: null,
    recovery: null,
    availableWeb: null,
    observedAt: UPGRADE_TEST_TIME,
  };
}
export function attemptFixture(): UpgradeAttempt {
  return {
    instanceId: 'instance-a',
    attemptId: '00000000-0000-4000-8000-000000000001',
    requestId: '00000000-0000-4000-8000-000000000002',
    targetReleaseId: '0.2.5',
    targetDigest: DIGEST_B,
    generation: 8,
    sequence: 1,
    state: 'downloading',
    stage: '下载升级包',
    percent: 20,
    completedWork: 20,
    totalWork: 100,
    planDigest: DIGEST_B,
    acceptedAt: UPGRADE_TEST_TIME,
    observedAt: UPGRADE_TEST_TIME,
    reason: null,
  };
}
export function unknownUpgradeFixture(): UpgradeStatus {
  const result = upgradeFixture();
  return {
    ...result,
    observedAt: new Date().toISOString(),
    confirmedServiceRelease: null,
    lastConfirmedServiceRelease: null,
    serviceState: 'unknown',
    catalog: {
      state: 'unknown',
      observedAt: null,
      availableRelease: null,
      reason: '本测试未配置真实升级目录',
    },
    capabilities: { canUpgradeInstance: false, canAuthenticate: false },
  };
}
