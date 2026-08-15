// 沙箱生命周期映射（纯函数，可单测）。把后端 12 值 status 归约为：
//  - 生命周期决策：startup(启动中) / running(可开终端) / failed / ended / unknown
//  - 启动四阶段（P20 §3.3）：初始化 / 准备工作区 / 拉取镜像 / 启动实例
// UI 决策不散落在容器条件里，集中在此，view 只吃派生结果。
import { normalizeOrigin } from '@/lib/terminalSocket';
import type { components } from '@/types/generated/openapi';

/** 后端权威 12 值状态（生成类型约束；events 通道 status 为自由字符串，运行时对齐这些取值）。 */
export type SandboxLifecycleStatus = components['schemas']['SandboxResponseDto']['status'];

export const EVENTS_NAMESPACE = '/events';

/** `<origin>/events`：交给 io() 作为连接 uri。 */
export function buildEventsSocketUri(base: string): string {
  return `${normalizeOrigin(base)}${EVENTS_NAMESPACE}`;
}

export type LifecycleDecision = 'startup' | 'running' | 'failed' | 'ended' | 'unknown';

/** 启动四阶段（顺序即进度顺序）。 */
export const STARTUP_PHASES = [
  { key: 'init', label: '初始化' },
  { key: 'workspace', label: '准备工作区' },
  { key: 'image', label: '拉取镜像' },
  { key: 'instance', label: '启动实例' },
] as const;

/** status → 启动阶段下标（仅 startup 决策下有意义）。 */
const STATUS_TO_PHASE_INDEX: Record<string, number> = {
  pending: 0,
  scheduling: 0,
  'preparing-workspace': 1,
  creating: 2,
  starting: 3,
};

const ENDED_STATUSES = new Set(['stopping', 'stopped', 'destroying', 'destroyed']);

/** 生命周期决策：容器据此在「启动中进度 / 终端 / 失败」间切换。 */
export function classifyStatus(status: string): LifecycleDecision {
  if (status in STATUS_TO_PHASE_INDEX) return 'startup';
  // idle 是 running 的子态（空闲计时），终端仍可用 → 同样开终端。
  if (status === 'running' || status === 'idle') return 'running';
  if (status === 'failed') return 'failed';
  if (ENDED_STATUSES.has(status)) return 'ended';
  return 'unknown';
}

/** 当前启动阶段下标（未知 status 落 0，避免进度条塌陷）。 */
export function phaseIndexForStatus(status: string): number {
  return STATUS_TO_PHASE_INDEX[status] ?? 0;
}

/**
 * 启动进度百分比：随阶段推进但在 running 之前永不到 100%（避免"卡死在 100%"观感，P20 §3.3）。
 * 冷启可能 ~220s，故每阶段内给到该阶段中点偏上，整体单调递增。
 */
export function startupPercent(status: string): number {
  const idx = phaseIndexForStatus(status);
  // (idx+1)/(阶段数+1)：4 阶段 → 20% / 40% / 60% / 80%，running 时由容器切走。
  return Math.round(((idx + 1) / (STARTUP_PHASES.length + 1)) * 100);
}
