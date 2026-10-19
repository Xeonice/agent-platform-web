import type {
  LoadedWebBuild,
  UpgradeDisplayModel,
  UpgradeObservation,
  UpgradeStatus,
  UpgradeAttempt,
  UpgradeOperation,
} from '@/types/upgrade';

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}
function formatWork(value: number, bytes: boolean): string {
  return bytes ? `${(value / 1024 / 1024).toFixed(1)} MB` : String(value);
}
function completionSummary(
  operation: UpgradeOperation | null | undefined,
  confirmedRelease: string,
): string | undefined {
  if (
    operation?.state !== 'completed' ||
    operation.finalTargetReleaseId !== confirmedRelease ||
    operation.defaultImageUpdate?.scope !== 'managed-default' ||
    !operation.defaultImageUpdate.images.some(
      (image) => image.previousRef !== image.ref || image.previousDigest !== image.digest,
    )
  )
    return undefined;
  return '平台已更新；之后选择本次更新的默认镜像的新任务使用新版工具，已有任务继续原环境。自定义默认及显式选择的其他镜像保持原配置。';
}

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
const CONTROL_STATE_LABELS = {
  ready: '独立控制已就绪',
  passive: '只读观察，尚未接管控制',
  reconciling: '正在核对原操作',
  unavailable: '控制状态暂不可用',
};
const RECOVERY_PHASE_LABELS = {
  created: '已接纳恢复',
  reconciling: '核对原动作和当前服务',
  restoring: '恢复合格的服务组合',
  verifying: '验证服务与原任务',
  recovered: '恢复已确认',
  blocked: '恢复受阻',
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
      const oldOperation = old.operation;
      const operation = next.operation;
      if (
        oldOperation !== null &&
        oldOperation !== undefined &&
        operation !== null &&
        operation !== undefined &&
        operation.operationId !== oldOperation.operationId &&
        Date.parse(operation.acceptedAt) < Date.parse(oldOperation.acceptedAt)
      )
        return previous;
      if (
        oldOperation !== null &&
        oldOperation !== undefined &&
        operation?.operationId === oldOperation.operationId
      ) {
        if (
          operation.sequence < oldOperation.sequence ||
          Date.parse(operation.observedAt) < Date.parse(oldOperation.observedAt) ||
          operation.currentStageIndex < oldOperation.currentStageIndex
        )
          return previous;
        if (
          operation.sequence === oldOperation.sequence &&
          JSON.stringify({ ...operation, observedAt: null }) !==
            JSON.stringify({ ...oldOperation, observedAt: null })
        )
          return { ...previous, uncertain: true, reason: '升级计划观测发生冲突，等待确认原请求' };
        if (
          operation.finalTargetDigest !== oldOperation.finalTargetDigest ||
          operation.finalTargetReleaseId !== oldOperation.finalTargetReleaseId ||
          operation.stages.length !== oldOperation.stages.length ||
          operation.stages.some((stage, index) => {
            const beforeStage = oldOperation.stages[index];
            return (
              stage.targetDigest !== beforeStage?.targetDigest ||
              stage.releaseId !== beforeStage.releaseId ||
              (beforeStage.attemptId !== null && stage.attemptId !== beforeStage.attemptId)
            );
          })
        )
          return {
            ...previous,
            uncertain: true,
            reason: '固定升级目标或兼容准备计划发生冲突，等待确认原请求',
          };
        if (oldOperation.state === 'completed' && operation.state !== 'completed') return previous;
      }
      const oldContract = old.contract;
      const nextContract = next.contract;
      const previousContractAttempt = oldContract?.attempt;
      const nextContractAttempt = nextContract?.attempt;
      if (
        previousContractAttempt &&
        previousContractAttempt.contractAttemptId === nextContractAttempt?.contractAttemptId
      ) {
        if (nextContractAttempt.sequence < previousContractAttempt.sequence) return previous;
        if (
          nextContractAttempt.targetPlanDigest !== previousContractAttempt.targetPlanDigest ||
          nextContractAttempt.activationGeneration !==
            previousContractAttempt.activationGeneration ||
          nextContractAttempt.completedRows < previousContractAttempt.completedRows ||
          (nextContractAttempt.sequence === previousContractAttempt.sequence &&
            JSON.stringify(nextContractAttempt) !== JSON.stringify(previousContractAttempt))
        ) {
          return { ...previous, uncertain: true, reason: '数据清理观测发生冲突，等待原请求确认' };
        }
      }
      if (oldContract?.authority === 'new' && nextContract?.authority === 'legacy') {
        return {
          ...previous,
          uncertain: true,
          reason: '数据格式权威暂时无法确认，保留最后已知事实',
        };
      }
      if (before !== null && after !== null && before.attemptId === after.attemptId) {
        if (
          after.generation < before.generation ||
          (after.generation === before.generation && after.sequence < before.sequence)
        )
          return previous;
        // An unknown step can acquire a real total after its durable completion.
        // That resolves the same plan; it does not authorize changing a known total.
        const resolvedTotal =
          before.totalWork === null &&
          after.totalWork !== null &&
          (after.generation > before.generation ||
            (after.generation === before.generation && after.sequence > before.sequence)) &&
          Number.isFinite(after.totalWork) &&
          Number.isFinite(after.completedWork) &&
          after.completedWork >= 0 &&
          after.totalWork >= after.completedWork;
        if (
          after.targetDigest !== before.targetDigest ||
          after.planDigest !== before.planDigest ||
          after.targetReleaseId !== before.targetReleaseId ||
          (after.totalWork !== before.totalWork && !resolvedTotal)
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
      if (
        old.recovery !== null &&
        next.recovery?.recoveryAttemptId === old.recovery.recoveryAttemptId
      ) {
        if (
          next.recovery.triggeringAttemptId !== old.recovery.triggeringAttemptId ||
          next.recovery.planDigest !== old.recovery.planDigest ||
          (old.recovery.triggeringOperationId !== undefined &&
            next.recovery.triggeringOperationId !== old.recovery.triggeringOperationId) ||
          (old.recovery.confirmedAt != null &&
            next.recovery.confirmedAt !== old.recovery.confirmedAt)
        )
          return { ...previous, uncertain: true, reason: '恢复记录发生冲突，只查询原恢复过程' };
        if (
          old.recovery.state === 'recovery-confirmed' &&
          next.recovery.state !== 'recovery-confirmed'
        )
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
    {
      label: '本次升级目标',
      value:
        data?.operation?.finalTargetReleaseId ?? data?.attempt?.targetReleaseId ?? '尚未发起升级',
    },
    {
      label: '可刷新页面版本',
      value:
        data?.availableWeb === null || data?.availableWeb === undefined
          ? '尚未确认页面刷新目标'
          : `${data.availableWeb.webReleaseId ?? '未标注版本'} · ${data.availableWeb.webRevision.slice(0, 8)}`,
    },
  ];
  const availability = data?.serviceAvailability;
  const availabilityFresh =
    availability?.observedAt !== null &&
    availability?.observedAt !== undefined &&
    data !== null &&
    observation !== null &&
    Math.max(0, Date.parse(data.observedAt) - Date.parse(availability.observedAt)) +
      Math.max(0, now - observation.receivedAt) <=
      UPGRADE_OBSERVATION_MS;
  if (availability !== undefined)
    facts.push({
      label: '服务可用性',
      value: availabilityFresh
        ? availability.state === 'available'
          ? '可继续使用'
          : availability.state === 'unavailable'
            ? '当前不可用'
            : '待确认'
        : '待确认（保留上次检查记录）',
    });
  if (data?.lastConfirmedServiceRelease !== null && data?.lastConfirmedServiceRelease !== undefined)
    facts.push({ label: '上次完整确认版本', value: data.lastConfirmedServiceRelease.releaseId });
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
  if (current !== null && current !== undefined)
    facts.push({ label: '完整版本确认时间', value: current.activatedAt });
  const operation = data?.operation;
  if (operation !== null && operation !== undefined)
    facts.push({
      label: '本次升级结果',
      value:
        operation.state === 'completed'
          ? '最终目标曾确认完成 · 100%（历史）'
          : operation.state === 'failed'
            ? '最终目标未完成'
            : operation.state === 'deferred'
              ? '已延后'
              : '已受理，进行中',
    });
  const control = data?.controlSystem;
  const controlFresh =
    control !== undefined &&
    data !== null &&
    observation !== null &&
    !observation.uncertain &&
    Date.parse(control.observedAt) <= Date.parse(data.observedAt) + 1000 &&
    Math.max(0, Date.parse(data.observedAt) - Date.parse(control.observedAt)) +
      Math.max(0, now - observation.receivedAt) <=
      UPGRADE_OBSERVATION_MS;
  if (control !== undefined)
    details.push(
      { label: '升级控制系统版本', value: control.version },
      { label: '升级控制协议', value: String(control.protocolVersion) },
      {
        label: '升级控制状态',
        value: `${CONTROL_STATE_LABELS[control.state]}${controlFresh ? '' : ' · 当前待确认'}`,
      },
      { label: '升级控制检查时间', value: control.observedAt },
    );
  const diagnostics = data?.diagnostics;
  if (diagnostics !== undefined)
    details.push(
      { label: '诊断关联标识', value: diagnostics.correlationId },
      { label: '诊断阶段', value: diagnostics.phase },
      { label: '诊断类别', value: diagnostics.code },
      { label: '诊断记录时间', value: diagnostics.recordedAt },
    );
  const recovery = data?.recovery ?? null;
  if (recovery != null) {
    details.push({ label: '恢复关联标识', value: recovery.recoveryAttemptId });
    if (recovery.diagnosticId !== undefined)
      details.push({ label: '恢复诊断标识', value: recovery.diagnosticId });
  }
  const base: UpgradeDisplayModel = {
    phase: 'none',
    showEntry: false,
    showDot: false,
    title: '版本与更新',
    subtitle: '检查更新只读取版本信息',
    percent: null,
    progressText: null,
    lastSeenText:
      data === null
        ? null
        : data.observation === undefined
          ? `版本记录时间 ${data.observedAt}`
          : data.observation.confirmedAt === null
            ? '服务状态尚未确认'
            : `上次服务确认 ${data.observation.confirmedAt}`,
    canUpgrade: false,
    canRefresh: false,
    facts,
    artifactDetails: details,
    canContinueWorking: availabilityFresh && availability.state === 'available',
    diagnosticText:
      data === null
        ? undefined
        : JSON.stringify(
            {
              instanceId: data.instanceId,
              activationGeneration: data.activationGeneration,
              operationId: data.operation?.operationId ?? null,
              requestId: data.operation?.requestId ?? data.attempt?.requestId ?? null,
              attemptId: data.attempt?.attemptId ?? null,
              targetReleaseId:
                data.operation?.finalTargetReleaseId ?? data.attempt?.targetReleaseId ?? null,
              state: data.operation?.state ?? data.attempt?.state ?? data.serviceState,
              observedAt: data.observedAt,
              serviceAvailability: data.serviceAvailability?.state ?? 'unknown',
              controlSystem: data.controlSystem,
              diagnostics: data.diagnostics,
              recovery:
                data.recovery === null
                  ? null
                  : {
                      recoveryAttemptId: data.recovery.recoveryAttemptId,
                      triggeringAttemptId: data.recovery.triggeringAttemptId,
                      triggeringOperationId: data.recovery.triggeringOperationId,
                      state: data.recovery.state,
                      phase: data.recovery.phase,
                      confirmedAt: data.recovery.confirmedAt,
                      observedAt: data.recovery.observedAt,
                      diagnosticId: data.recovery.diagnosticId,
                    },
            },
            null,
            2,
          ),
  };
  if (recovery != null) {
    const stale =
      data === null ||
      observation === null ||
      observation.uncertain ||
      Date.parse(recovery.observedAt) > Date.parse(data.observedAt) + 1000 ||
      Math.max(0, Date.parse(data.observedAt) - Date.parse(recovery.observedAt)) +
        Math.max(0, now - observation.receivedAt) >
        UPGRADE_OBSERVATION_MS;
    const stateText =
      recovery.state === 'recovery-confirmed'
        ? '服务恢复已确认'
        : recovery.state === 'recovering'
          ? '正在恢复服务'
          : recovery.state === 'failed'
            ? '恢复受阻'
            : '恢复结果待确认';
    base.recoverySummary = {
      stateText: stale ? `上次记录：${stateText} · 当前状态待确认` : stateText,
      phaseText: recovery.phase === undefined ? null : RECOVERY_PHASE_LABELS[recovery.phase],
      confirmedAt: recovery.confirmedAt ?? null,
      lastObservedAt: recovery.observedAt,
      stale,
    };
  }
  const confirmedAge =
    data?.observation?.confirmedAt === null ||
    data?.observation?.confirmedAt === undefined ||
    observation === null
      ? 0
      : Math.max(0, Date.parse(data.observedAt) - Date.parse(data.observation.confirmedAt)) +
        Math.max(0, now - observation.receivedAt);
  const stage = data?.currentStageProgress;
  const operationStage = data?.operation?.stages[data.operation.currentStageIndex];
  const stageBound =
    data?.operation === null ||
    data?.operation === undefined ||
    (data.attempt !== null &&
      operationStage?.attemptId === data.attempt.attemptId &&
      operationStage.targetDigest === data.attempt.targetDigest &&
      operationStage.releaseId === data.attempt.targetReleaseId);
  if (stageBound && stage !== null && stage !== undefined) {
    const valid =
      Number.isFinite(stage.completedWork) &&
      stage.completedWork >= 0 &&
      (stage.totalWork === null ||
        (Number.isFinite(stage.totalWork) && stage.totalWork >= stage.completedWork));
    const stale =
      confirmedAge > UPGRADE_OBSERVATION_MS ||
      observation === null ||
      observation.uncertain ||
      now - observation.receivedAt > UPGRADE_OBSERVATION_MS ||
      data?.observation?.state === 'stale' ||
      data?.observation?.state === 'checking';
    const downloading = data?.attempt?.state === 'downloading';
    base.stageProgress = {
      label: downloading
        ? '安装包下载阶段'
        : data?.attempt === null || data?.attempt === undefined
          ? '当前准备阶段'
          : (STAGE_LABELS[data.attempt.state] ?? '当前升级阶段'),
      percent:
        valid &&
        stage.percent !== null &&
        Number.isFinite(stage.percent) &&
        stage.percent >= 0 &&
        stage.percent <= 100
          ? stage.percent
          : null,
      workText: valid
        ? `${formatWork(stage.completedWork, downloading)}${stage.totalWork === null ? ' / 总量待确认' : ` / ${formatWork(stage.totalWork, downloading)}`}`
        : null,
      elapsedText:
        stage.enteredAt === null
          ? null
          : `当前阶段已用 ${formatDuration(now - Date.parse(stage.enteredAt))}`,
      lastProgressText:
        stage.lastProgressAt === null
          ? null
          : `最后实质进展 ${new Date(stage.lastProgressAt).toLocaleString()}`,
      stale,
    };
  }
  if (
    data === null ||
    observation === null ||
    observation.uncertain ||
    now - observation.receivedAt > UPGRADE_OBSERVATION_MS
  ) {
    return {
      ...base,
      phase: 'unknown',
      subtitle: observation?.reason ?? data?.observation?.reason ?? '暂时无法确认版本与升级状态',
    };
  }
  const physicalUncertain =
    confirmedAge > UPGRADE_OBSERVATION_MS ||
    data.observation?.state === 'stale' ||
    data.observation?.state === 'checking';
  if (physicalUncertain)
    facts[0] = {
      label: '当前服务版本',
      value: `上次完整确认 ${current?.releaseId ?? '未知'} · 当前状态待确认`,
    };
  if (data.serviceState !== 'confirmed') {
    facts[0] = {
      label: '当前服务版本',
      value: `切换中／待确认${data.lastConfirmedServiceRelease === null ? '' : ` · 上次完整版本 ${data.lastConfirmedServiceRelease.releaseId}`}`,
    };
  }
  const attempt = data.attempt;
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
  const canAcceptNewAttempt =
    !physicalUncertain &&
    (control === undefined || (control.state === 'ready' && controlFresh)) &&
    (data.serviceState === 'confirmed' || repairFresh);
  const recovering =
    (data.operation === null ||
      data.operation === undefined ||
      operationStage?.attemptId === attempt?.attemptId) &&
    recovery !== null &&
    recovery.triggeringAttemptId === attempt?.attemptId &&
    (recovery.state === 'recovering' || (recovery.state !== 'recovery-confirmed' && !repairFresh));
  if (
    operation !== null &&
    operation !== undefined &&
    ['accepted', 'preparing', 'running'].includes(operation.state) &&
    !recovering
  ) {
    const currentStage = operation.stages[operation.currentStageIndex];
    const bridgeDone =
      operation.currentStageIndex > 0 &&
      operation.stages
        .slice(0, operation.currentStageIndex)
        .every((item) => item.state === 'confirmed');
    return {
      ...base,
      phase: 'ongoing',
      showEntry: true,
      title: '正在升级到最终版本',
      subtitle: `${operation.finalTargetReleaseId} · ${bridgeDone ? '兼容准备完成，继续更新最终版本' : operation.state === 'accepted' || operation.state === 'preparing' ? '准备升级，长检查在后台继续' : '正在更新并验证服务'}`,
      percent: null,
      progressText:
        currentStage?.state === 'confirmed'
          ? '兼容准备已确认，继续同一次升级'
          : '本次总体进度待确认；按实际阶段展示',
      lastSeenText: `最后确认 ${operation.observedAt}`,
    };
  }
  if (
    operation !== null &&
    operation !== undefined &&
    (operation.state === 'failed' || operation.state === 'deferred') &&
    !recovering
  ) {
    return {
      ...base,
      phase: 'failed',
      title: '本次升级未完成',
      subtitle: repairFresh
        ? '升级未完成，部分组件已更新'
        : operation.state === 'deferred'
          ? '升级已延后，最终目标尚未完成'
          : '最终目标尚未完成，当前服务组合需确认',
      progressText: operation.reason,
      canUpgrade:
        data.catalog.state === 'verified' &&
        data.catalog.availableRelease !== null &&
        data.capabilities.canUpgradeInstance &&
        canAcceptNewAttempt,
      ...(repairFresh && data.catalog.availableRelease !== null
        ? { upgradeActionLabel: `修复到 ${data.catalog.availableRelease.releaseId}` }
        : {}),
    };
  }
  if (attempt !== null && ONGOING.has(attempt.state) && !recovering) {
    const age =
      Math.max(0, Date.parse(data.observedAt) - Date.parse(attempt.observedAt)) +
      Math.max(0, now - observation.receivedAt);
    const validWork =
      Number.isFinite(attempt.completedWork) &&
      attempt.completedWork >= 0 &&
      (attempt.totalWork === null ||
        (Number.isFinite(attempt.totalWork) && attempt.completedWork <= attempt.totalWork));
    const known =
      age <= UPGRADE_OBSERVATION_MS &&
      validWork &&
      attempt.percent !== null &&
      Number.isFinite(attempt.percent) &&
      attempt.percent >= 0 &&
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
  if (physicalUncertain)
    return {
      ...base,
      phase: 'unknown',
      subtitle: data.observation?.reason ?? '服务状态待确认，保留最后已知版本；只读检查不重复升级',
    };
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
    (operation === null ||
      operation === undefined ||
      (operation.state === 'completed' &&
        operation.percent === 100 &&
        operation.finalTargetReleaseId === confirmed.releaseId)) &&
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
      title: recovered ? '服务恢复已确认' : '实例已安装新版',
      subtitle: `页面 ${loaded.releaseId ?? '未标注版本'} · ${loaded.webRevision?.slice(0, 8) ?? '未注入'} → ${web.webReleaseId ?? '未标注版本'} · ${web.webRevision.slice(0, 8)}，刷新后续接原终端`,
      percent: recovered ? null : 100,
      canRefresh: true,
      ...(completionSummary(operation, confirmed.releaseId) === undefined
        ? {}
        : { completionSummary: completionSummary(operation, confirmed.releaseId) }),
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
        ? '服务恢复已确认'
        : attempt.state === 'deferred'
          ? '升级已延后'
          : repairFresh
            ? '升级未完成，部分组件已更新'
            : '本次升级未完成',
      progressText: recovery?.reason ?? attempt.reason,
      canUpgrade:
        data.catalog.state === 'verified' &&
        available !== null &&
        data.capabilities.canUpgradeInstance &&
        canAcceptNewAttempt,
      ...(repairFresh && available !== null
        ? { upgradeActionLabel: `修复到 ${available.releaseId}` }
        : {}),
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
          ? '服务恢复已确认'
          : recovery.state === 'recovering'
            ? '正在恢复服务'
            : '恢复待确认',
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
      ...(completionSummary(operation, confirmed.releaseId) === undefined
        ? {}
        : { completionSummary: completionSummary(operation, confirmed.releaseId) }),
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
