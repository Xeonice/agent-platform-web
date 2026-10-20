import type { UpgradeStatus } from '@/types/upgrade-contract';
import type { ContractFinalizeDisplay } from '@/types/upgrade';

export const ACTIVE_CONTRACT_STATES = new Set([
  'accepted',
  'retiring-readers',
  'authority-active',
  'clearing',
]);
const labels: Record<string, string> = {
  accepted: '清理请求已受理',
  'retiring-readers': '正在退休旧版本读者',
  'authority-active': '当前数据格式已成为权威，正在确认清理',
  clearing: '正在清理旧数据格式',
  completed: '旧数据格式清理已完成',
  deferred: '数据清理已延后',
  failed: '本次数据清理未完成',
  unknown: '清理结果待确认',
};
export function deriveContractFinalize(
  snapshot: UpgradeStatus | null,
  uncertain: boolean,
  now: number,
): ContractFinalizeDisplay {
  const contract = snapshot?.contract;
  if (!snapshot || !contract)
    return { visible: false, canExecute: false, status: '', reason: null, facts: [] };
  const attempt = contract.attempt,
    plan = contract.availablePlan;
  const fresh =
    !uncertain &&
    now >= Date.parse(snapshot.observedAt) - 1000 &&
    now - Date.parse(snapshot.observedAt) <= 5000;
  const canExecute =
    fresh &&
    snapshot.capabilities.canContract === true &&
    snapshot.serviceState === 'confirmed' &&
    contract.authority === 'legacy' &&
    plan?.eligible === true &&
    plan.releaseId === snapshot.confirmedServiceRelease?.releaseId &&
    (attempt === null ||
      (!ACTIVE_CONTRACT_STATES.has(attempt.state) && attempt.state !== 'unknown'));
  return {
    visible: true,
    canExecute,
    status: !fresh
      ? '暂时无法确认数据清理状态'
      : attempt
        ? (labels[attempt.state] ?? '清理结果待确认')
        : contract.authority === 'new'
          ? '当前数据格式已成为权威'
          : contract.authority === 'unknown'
            ? '数据格式权威待确认'
            : plan?.eligible === true
              ? '旧数据格式可单独清理'
              : '旧数据格式继续保留',
    reason: !fresh
      ? '请检查原请求与当前状态，暂不执行新的清理请求。'
      : (attempt?.reason ?? plan?.reason ?? null),
    facts: [
      ...(plan
        ? [
            { label: '所属服务版本', value: plan.releaseId },
            { label: '回退窗口截止', value: plan.rollbackWindowClosesAt },
            { label: '旧版本读者', value: String(plan.legacyReaderCount) },
          ]
        : []),
      ...(attempt
        ? [
            { label: '本次清理阶段', value: attempt.stage },
            {
              label: '已清理行数',
              value: `${String(attempt.completedRows)} / ${attempt.totalRows === null ? '待确认' : String(attempt.totalRows)}`,
            },
          ]
        : []),
    ],
  };
}
export function contractPendingKey(instanceId: string, userScope: string): string {
  return 'platform:contract-request:v1:' + JSON.stringify([instanceId, userScope]);
}
