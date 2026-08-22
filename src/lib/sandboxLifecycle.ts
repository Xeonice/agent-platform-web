// 沙箱生命周期映射（纯函数，可单测）。把后端 12 值 status 归约为：
//  - 生命周期决策：startup(启动中) / running(可开终端) / failed / ended / unknown
//  - 启动四阶段（P20 §3.3，**展示序**）：初始化 / 拉取镜像 / 准备工作区 / 启动实例
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

/**
 * 启动进度卡的四个**展示格**（P20 §3.3）。
 *
 * ⚠️ **展示顺序 ≠ 状态机顺序，这是刻意的**（03 §4.0 / F21-2 §6）：
 * 技术上工作区必须先备好（`scheduling → preparing-workspace → creating → starting`，
 * 这样 `provider.create()` 时卷已存在）；但用户心智里"拉镜像"在"准备工作区"之前
 * （先有环境再有代码），因此进度卡按「初始化 → 拉取镜像 → 准备工作区 → 启动实例」渲染。
 *
 * **实现时不要"顺手把展示顺序改成和状态机一致"**——三件事在此刻意解耦：
 *   ① 格的顺序 = 本数组；
 *   ② status → 格 = `STATUS_TO_PHASE_KEY`（多对一）；
 *   ③ 进度条百分比 = `STATUS_TECH_RANK`（技术推进序，保证单调递增，不受展示顺序影响）。
 */
export const STARTUP_PHASES = [
  { key: 'init', label: '初始化' },
  { key: 'image', label: '拉取镜像' },
  { key: 'workspace', label: '准备工作区' },
  { key: 'instance', label: '启动实例' },
] as const;

export type StartupPhaseKey = (typeof STARTUP_PHASES)[number]['key'];

/**
 * 「启动实例」格：装 runtime CLI、注入凭证、起 agent 会话都发生在这一格内（03 §4.3 / P20 §3.3 步骤 2），
 * `runtime.install_progress` 的子文案就挂它下面。
 */
export const INSTANCE_PHASE_KEY: StartupPhaseKey = 'instance';

/**
 * status → 展示格 key（多对一）。**这里就是"展示顺序 ≠ 技术顺序"落到代码的那一处**：
 * `preparing-workspace` 落「准备工作区」（展示第 3 格）、`creating` 落「拉取镜像」（展示第 2 格），
 * 即技术上后发生的 `creating` 反而点亮更靠前的格——这是预期，不是 bug。
 */
const STATUS_TO_PHASE_KEY: Record<string, StartupPhaseKey> = {
  pending: 'init',
  scheduling: 'init',
  'preparing-workspace': 'workspace',
  creating: 'image',
  starting: 'instance',
};

/**
 * status → **技术推进序号**（0..3）。只用于算百分比：展示格下标不随技术推进单调，
 * 拿它去算进度条会出现"进度倒退"（`preparing-workspace` 40% → `creating` 60% 才对，
 * 但展示格是 2 → 1）。故百分比一律走本表，与展示格解耦。
 */
const STATUS_TECH_RANK: Record<string, number> = {
  pending: 0,
  scheduling: 0,
  'preparing-workspace': 1,
  creating: 2,
  starting: 3,
};

const ENDED_STATUSES = new Set(['stopping', 'stopped', 'destroying', 'destroyed']);

/** 生命周期决策：容器据此在「启动中进度 / 终端 / 失败」间切换。 */
export function classifyStatus(status: string): LifecycleDecision {
  if (status in STATUS_TO_PHASE_KEY) return 'startup';
  // idle 是 running 的子态（空闲计时），终端仍可用 → 同样开终端。
  if (status === 'running' || status === 'idle') return 'running';
  if (status === 'failed') return 'failed';
  if (ENDED_STATUSES.has(status)) return 'ended';
  return 'unknown';
}

/** 当前 status 对应的**展示格 key**（未知 status 落首格，避免进度卡塌陷）。 */
export function phaseKeyForStatus(status: string): StartupPhaseKey {
  return STATUS_TO_PHASE_KEY[status] ?? 'init';
}

/** 当前**展示格下标**（未知 status 落 0）。注意：它不随技术推进单调，见 STARTUP_PHASES 注释。 */
export function phaseIndexForStatus(status: string): number {
  const key = phaseKeyForStatus(status);
  return STARTUP_PHASES.findIndex((p) => p.key === key);
}

/**
 * 启动进度百分比：随**技术推进**单调递增，且在 running 之前永不到 100%
 * （避免"卡死在 100%"观感，P20 §3.3）。冷启可能 ~220s（装 CLI 时更久，见 install 子文案）。
 */
export function startupPercent(status: string): number {
  const rank = STATUS_TECH_RANK[status] ?? 0;
  // (rank+1)/(阶段数+1)：4 阶段 → 20% / 40% / 60% / 80%，running 时由容器切走。
  return Math.round(((rank + 1) / (STARTUP_PHASES.length + 1)) * 100);
}
