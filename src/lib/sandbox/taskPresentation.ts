import { phaseKeyForStatus } from '@/lib/sandbox/sandboxLifecycle';
import { describeSandboxError } from '@/lib/sandbox/sandboxErrorCopy';
export const STUCK_HINT_MS = 300_000;
export function isSandboxStuck(
  status: string,
  lastProgressAt: number,
  now: number,
  installing: boolean,
): boolean {
  return (
    ['pending', 'scheduling', 'preparing-workspace', 'creating', 'starting'].includes(status) &&
    !installing &&
    now - lastProgressAt >= STUCK_HINT_MS
  );
}
export function taskPhaseLabel(
  status: string,
  failureCode?: string,
  failureOperation?: string,
): string {
  if (status === 'stopping') return '停止中…';
  if (status === 'destroying' || status === 'destroyed') return '删除中…';
  if (status === 'stopped') return '已停止';
  if (
    status === 'failed' &&
    failureCode === 'TIMEOUT' &&
    failureOperation !== 'stop' &&
    failureOperation !== 'destroy'
  )
    return describeSandboxError({ code: failureCode }).title;
  if (status === 'failed')
    return `${failureOperation === 'stop' ? '停止' : failureOperation === 'destroy' ? '删除' : '启动'}失败：${describeSandboxError({ code: failureCode }).title}`;
  if (['running', 'idle'].includes(status)) return status === 'idle' ? '空闲' : '运行中';
  const labels = {
    init: '初始化',
    image: '拉取镜像',
    workspace: '准备代码副本',
    instance: '启动运行环境',
  };
  return `准备中 · ${labels[phaseKeyForStatus(status)]}`;
}
