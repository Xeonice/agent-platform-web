import type {
  LoadedWebBuild,
  UpgradeDisplayModel,
  UpgradeObservation,
  UpgradeStatus,
  UpgradeAttempt,
} from '@/types/upgrade';

const ONGOING = new Set([
  'accepted',
  'downloading',
  'package-verified',
  'migrating',
  'prepared',
  'candidate-ready',
  'routing-switched',
  'observing',
  'api-activated',
]);
const STAGE_LABELS: Partial<Record<UpgradeAttempt['state'], string>> = {
  accepted: '准备本次升级',
  downloading: '下载升级包',
  'package-verified': '校验升级包',
  migrating: '更新兼容的数据结构',
  prepared: '准备候选服务',
  'candidate-ready': '检查候选服务',
  'routing-switched': '切换服务入口',
  observing: '验证服务与任务连续性',
  'api-activated': '确认页面与整体服务',
};
/** Matches the maximum observation validity in the versioned controller contract. */
export const UPGRADE_OBSERVATION_MS = 5_000;

export function receiveUpgradeStatus(
  previous: UpgradeObservation | null,
  next: UpgradeStatus,
  receivedAt: number,
): UpgradeObservation {
  if (previous?.snapshot !== null && previous?.snapshot !== undefined) {
    const old = previous.snapshot;
    if (old.instanceId === next.instanceId && old.userScope === next.userScope) {
      if (
        next.activationGeneration < old.activationGeneration ||
        Date.parse(next.observedAt) < Date.parse(old.observedAt)
      )
        return previous;
      const before = old.attempt;
      const after = next.attempt;
      if (before !== null && after !== null && before.attemptId === after.attemptId) {
        if (
          after.generation < before.generation ||
          (after.generation === before.generation && after.sequence < before.sequence)
        )
          return previous;
        if (
          after.targetDigest !== before.targetDigest ||
          after.planDigest !== before.planDigest ||
          after.targetReleaseId !== before.targetReleaseId ||
          after.totalWork !== before.totalWork
        ) {
          return { ...previous, uncertain: true, reason: '升级计划发生冲突，等待重新确认' };
        }
        if (
          after.generation === before.generation &&
          after.sequence === before.sequence &&
          JSON.stringify(after) !== JSON.stringify(before)
        ) {
          return { ...previous, uncertain: true, reason: '升级观测发生冲突，等待重新确认' };
        }
        if (
          after.completedWork < before.completedWork ||
          (after.percent !== null && before.percent !== null && after.percent < before.percent)
        ) {
          return { ...previous, uncertain: true, reason: '升级工作量暂时无法确认' };
        }
      }
      if (
        old.recovery !== null &&
        next.recovery !== null &&
        old.recovery.recoveryAttemptId === next.recovery.recoveryAttemptId &&
        (next.recovery.generation < old.recovery.generation ||
          (next.recovery.generation === old.recovery.generation &&
            next.recovery.sequence < old.recovery.sequence))
      ) {
        return previous;
      }
      // A late completion cannot resurrect a readiness explicitly withdrawn by recovery.
      if (old.recovery !== null && next.recovery === null && before?.attemptId === after?.attemptId)
        return previous;
    }
  }
  return { snapshot: next, receivedAt, uncertain: false, reason: null };
}

export function unknownUpgradeObservation(
  previous: UpgradeObservation | null,
  reason = '暂时无法确认版本与升级状态',
): UpgradeObservation {
  return {
    snapshot: previous?.snapshot ?? null,
    receivedAt: previous?.receivedAt ?? 0,
    uncertain: true,
    reason,
  };
}

export function deriveUpgradeModel(
  observation: UpgradeObservation | null,
  loaded: LoadedWebBuild,
  now: number,
): UpgradeDisplayModel {
  const data = observation?.snapshot ?? null;
  const facts: UpgradeDisplayModel['facts'] = [
    { label: '当前服务版本', value: data?.confirmedServiceRelease?.releaseId ?? '暂时无法确认' },
    { label: '当前页面版本', value: loaded.releaseId ?? '构建未标注版本' },
    {
      label: '可安装版本',
      value: data?.catalog.availableRelease?.releaseId ?? '暂无已确认可用版本',
    },
    { label: '本次升级目标', value: data?.attempt?.targetReleaseId ?? '尚未发起升级' },
    {
      label: '可刷新页面版本',
      value:
        data?.availableWeb === null || data?.availableWeb === undefined
          ? '尚未确认页面刷新目标'
          : `${data.availableWeb.webReleaseId ?? '未标注版本'} · ${data.availableWeb.webRevision.slice(0, 8)}`,
    },
  ];
  const current = data?.confirmedServiceRelease ?? data?.lastConfirmedServiceRelease;
  const details: UpgradeDisplayModel['artifactDetails'] =
    current === null || current === undefined
      ? []
      : [
          {
            label: data?.serviceState === 'confirmed' ? '实际 API 构建' : '上次完整 API 构建',
            value: current.components.api.sourceRevision,
          },
          { label: '实际 Web 构建', value: loaded.webRevision ?? '未注入' },
          ...(current.components.owner === undefined
            ? []
            : [
                {
                  label:
                    data?.serviceState === 'confirmed' ? '原运行服务构建' : '上次完整运行服务构建',
                  value: current.components.owner.sourceRevision,
                },
              ]),
        ];
  const base: UpgradeDisplayModel = {
    phase: 'none',
    showEntry: false,
    showDot: false,
    title: '版本与更新',
    subtitle: '检查更新只读取版本信息',
    percent: null,
    progressText: null,
    lastSeenText: data === null ? null : `上次确认 ${data.observedAt}`,
    canUpgrade: false,
    canRefresh: false,
    canAuthenticate:
      data !== null && data.capabilities.canAuthenticate && !data.capabilities.canUpgradeInstance,
    facts,
    artifactDetails: details,
  };
  if (
    data === null ||
    observation === null ||
    observation.uncertain ||
    now - observation.receivedAt > UPGRADE_OBSERVATION_MS
  ) {
    return {
      ...base,
      phase: 'unknown',
      canAuthenticate: false,
      subtitle: observation?.reason ?? '暂时无法确认版本与升级状态',
    };
  }
  if (data.serviceState !== 'confirmed') {
    facts[0] = {
      label: '当前服务版本',
      value: `切换中／待确认${data.lastConfirmedServiceRelease === null ? '' : ` · 上次完整版本 ${data.lastConfirmedServiceRelease.releaseId}`}`,
    };
  }
  const attempt = data.attempt;
  const recovery = data.recovery;
  // The server grants this only after measuring the actual partial installation.
  // An old successful release, a failed attempt or a browser hash cannot grant repair.
  const repair = data.repairableCurrent;
  const repairFresh =
    repair?.activationGeneration === data.activationGeneration &&
    repair.baseConfirmedReleaseId === current?.releaseId &&
    Date.parse(repair.observedAt) <= Date.parse(data.observedAt) + 1000 &&
    Math.max(0, Date.parse(data.observedAt) - Date.parse(repair.observedAt)) +
      Math.max(0, now - observation.receivedAt) <=
      UPGRADE_OBSERVATION_MS;
  const canAcceptNewAttempt = data.serviceState === 'confirmed' || repairFresh;
  const recovering =
    recovery !== null &&
    recovery.triggeringAttemptId === attempt?.attemptId &&
    (recovery.state === 'recovering' || (recovery.state !== 'recovery-confirmed' && !repairFresh));
  if (attempt !== null && ONGOING.has(attempt.state) && !recovering) {
    const age =
      Math.max(0, Date.parse(data.observedAt) - Date.parse(attempt.observedAt)) +
      Math.max(0, now - observation.receivedAt);
    const validWork =
      attempt.totalWork !== null &&
      Number.isFinite(attempt.totalWork) &&
      attempt.totalWork > 0 &&
      Number.isFinite(attempt.completedWork) &&
      attempt.completedWork >= 0 &&
      attempt.completedWork <= attempt.totalWork;
    const known =
      age <= UPGRADE_OBSERVATION_MS &&
      validWork &&
      attempt.percent !== null &&
      attempt.percent < 100;
    return {
      ...base,
      phase: 'ongoing',
      showEntry: true,
      title: '实例升级中',
      subtitle: `${current?.releaseId ?? '当前服务'} → ${attempt.targetReleaseId} · ${STAGE_LABELS[attempt.state] ?? '升级进行中'}`,
      percent: known ? attempt.percent : null,
      progressText: known
        ? `${STAGE_LABELS[attempt.state] ?? '升级进行中'} · ${String(attempt.percent)}%`
        : '等待进度确认',
      lastSeenText: `最后确认${attempt.percent === null ? '' : ` ${String(attempt.percent)}%`} · ${attempt.observedAt}`,
    };
  }
  const web = data.availableWeb;
  const confirmed = data.confirmedServiceRelease;
  const webFresh =
    web !== null &&
    Math.max(0, Date.parse(data.observedAt) - Date.parse(web.observedAt)) +
      Math.max(0, now - observation.receivedAt) <=
      UPGRADE_OBSERVATION_MS;
  const recovered =
    recovery !== null &&
    recovery.triggeringAttemptId === attempt?.attemptId &&
    recovery.state === 'recovery-confirmed';
  const ready =
    web !== null &&
    webFresh &&
    confirmed !== null &&
    !recovering &&
    data.serviceState === 'confirmed' &&
    web.instanceId === data.instanceId &&
    web.activationGeneration === data.activationGeneration &&
    confirmed.activationGeneration === data.activationGeneration &&
    web.releaseId === confirmed.releaseId &&
    web.productionBinding === confirmed.productionWebBinding &&
    web.artifactDigest === confirmed.components.web.artifactDigest &&
    web.webRevision === confirmed.components.web.webRevision &&
    loaded.webRevision !== null &&
    loaded.webRevision !== web.webRevision &&
    (recovered ||
      attempt === null ||
      (attempt.state === 'activation-confirmed' &&
        attempt.percent === 100 &&
        attempt.targetReleaseId === confirmed.releaseId));
  if (ready)
    return {
      ...base,
      phase: recovered ? 'recovery' : 'ready',
      showEntry: !recovered,
      showDot: !recovered,
      title: recovered ? '安全回退已确认' : '实例已安装新版',
      subtitle: `页面 ${loaded.releaseId ?? '未标注版本'} · ${loaded.webRevision?.slice(0, 8) ?? '未注入'} → ${web.webReleaseId ?? '未标注版本'} · ${web.webRevision.slice(0, 8)}，刷新后续接原终端`,
      percent: recovered ? null : 100,
      canRefresh: true,
    };
  const available = data.catalog.availableRelease;
  // A failed/deferred fixed target does not reopen a floating prompt automatically.
  // An authorized user can explicitly request another attempt from the permanent system card.
  const failedFixedTarget =
    attempt !== null &&
    !ONGOING.has(attempt.state) &&
    attempt.state !== 'activation-confirmed' &&
    (available === null || available.releaseId === attempt.targetReleaseId);
  if (failedFixedTarget && !recovering)
    return {
      ...base,
      phase: recovered ? 'recovery' : 'failed',
      subtitle: recovered
        ? '安全回退已确认'
        : attempt.state === 'deferred'
          ? '升级已延后'
          : '本次升级未完成',
      progressText: recovery?.reason ?? attempt.reason,
      canUpgrade:
        data.catalog.state === 'verified' &&
        available !== null &&
        data.capabilities.canUpgradeInstance &&
        canAcceptNewAttempt,
    };
  if (
    data.catalog.state === 'verified' &&
    available !== null &&
    available.releaseId !== confirmed?.releaseId &&
    !recovering
  ) {
    return {
      ...base,
      phase: 'available',
      showEntry: true,
      showDot: true,
      title: '发现新版本',
      subtitle: `${confirmed?.releaseId ?? '当前服务'} → ${available.releaseId} · 待升级`,
      canUpgrade: data.capabilities.canUpgradeInstance && canAcceptNewAttempt,
    };
  }
  if (recovering)
    return {
      ...base,
      phase: 'recovery',
      subtitle:
        recovery.state === 'recovery-confirmed'
          ? '安全回退已确认'
          : recovery.state === 'recovering'
            ? '安全回退中'
            : '回退待确认',
      progressText: recovery.reason,
      lastSeenText: `上次确认 ${recovery.observedAt}`,
    };
  if (attempt !== null && attempt.state !== 'activation-confirmed') {
    return {
      ...base,
      phase: 'failed',
      subtitle: attempt.state === 'deferred' ? '升级已延后' : '本次升级未完成',
      progressText: attempt.reason,
    };
  }
  if (data.catalog.state === 'unknown' || data.catalog.state === 'unavailable') {
    const subtitle =
      data.catalog.reason === 'GLOBAL_SCHEMA_MIGRATION_UNQUALIFIED'
        ? '当前版本的数据结构变更尚未具备连续升级验证，实例未应用该步骤并保留当前版本。完成兼容桥或独立维护方案后再升级。'
        : (data.catalog.reason ?? '暂时无法确认可安装版本');
    return { ...base, phase: 'unknown', subtitle };
  }
  if (
    attempt?.state === 'activation-confirmed' &&
    attempt.percent === 100 &&
    confirmed?.releaseId === attempt.targetReleaseId &&
    data.serviceState === 'confirmed'
  ) {
    return {
      ...base,
      percent: 100,
      subtitle:
        loaded.webRevision === confirmed.components.web.webRevision
          ? '本实例升级已确认，当前页面无需刷新'
          : '实例升级已确认，当前页面的刷新目标待核查，请检查更新。',
      progressText: '本次实例升级已完成 · 100%',
    };
  }
  if (data.serviceState !== 'confirmed')
    return { ...base, phase: 'unknown', subtitle: '当前服务状态待确认，保留上次完整版本。' };
  return {
    ...base,
    subtitle:
      data.catalog.state === 'no-update' ? '已核查，暂无可安装更新' : '本实例当前版本已确认',
  };
}
