// 沙箱运行时状态投影（10 §7.4）：keyed by sandboxId → { status, phase }。
// /events 通道 sandbox.status_changed 驱动；create 响应用于种子首值。
// 另含装 runtime CLI 的进度投影 runtimeInstalls（runtime.install_progress，S5）——见下方字段注释。
// ⚠️ 纯内存运行时态，不 persist（未纳入 partializeAppState 白名单）。
import type { StateCreator } from 'zustand';
import type { SandboxEvent } from '@/types/ws-protocol';
import type { RuntimeInstallProgress } from '@/lib/runtimeInstallProgress';

/** 返回去掉指定 key 的浅拷贝（避免 dynamic-delete / rest-siblings lint）。 */
function omitKey<T>(map: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
}

/** Task 转入这些状态后，装 CLI 的进度已无意义 → 清除该沙箱的 install 投影（15 §2.3）。 */
const INSTALL_TERMINAL_STATUSES = new Set([
  'running',
  'idle',
  'failed',
  'stopping',
  'stopped',
  'destroying',
  'destroyed',
]);

export interface SandboxRuntimeState {
  /** 后端 12 值生命周期状态（自由字符串，运行时校验后透传）。 */
  status: string;
  /** 细分阶段（可选，来自 status_changed.phase）。 */
  phase?: string;
  /**
   * 失败原因**码**（04 §4 闭集，无码兜底 INTERNAL），仅 `status:'failed'` 时有值。
   * 两条通道写同一个字段，互为补充、不互相打架：
   *   · **即时**：WS `sandbox.status_changed.errorCode`；
   *   · **刷新恢复**：REST `SandboxResponseDto.failureCode`（WS 帧错过了就没了，这条是救命稻草）。
   * ⚠️ `runtime.install_progress.errorCode` **不写这里**——它不是失败兜底通道（10 §3.1）。
   */
  failureCode?: string;
  /** 失败细节**自由文本**（排障用，来自 DTO `failureMessage`）。⚠️ 不 parse 它取码。 */
  failureMessage?: string;
}

/** REST DTO / WS 帧归一化后的一次写入。 */
export interface SandboxStatusPatch {
  phase?: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface SandboxStatusSlice {
  sandboxStatuses: Record<string, SandboxRuntimeState>;
  /**
   * 装 runtime CLI 的进度投影，keyed by sandboxId（`runtime.install_progress` 的唯一落点）。
   *
   * 纪律（15 §2.3）：这条事件**不 patch 任何 Query 字段**，只喂进度卡「启动实例」格下的子文案；
   * 随 Task 转入终态清除。**`failed` 既不改生命周期判定、也不作为失败原因来源**——
   * 权威是紧随其后的 `sandbox.status_changed → failed`（带 errorCode），
   * 刷新后的恢复来源是 `SandboxResponseDto.failureCode`（10 §3.1 明写它不是失败兜底通道）。
   *
   * ⚠️ 落点说明：15 §2.3 的原文写"落 uiSlice 的一个 Map"，本仓的 sandbox 运行时投影不在 uiSlice
   * 而在本 slice（uiSlice 只管选中/弹层/向导暂存），故与 sandboxStatuses 同表放置，语义不变。
   */
  runtimeInstalls: Record<string, RuntimeInstallProgress>;
  /**
   * REST 种子/显式写入（create 201 的首值、`GET /api/sandboxes/:id` 的刷新恢复都走这里）。
   * `patch` 里的 failureCode/failureMessage 直接取 DTO 同名字段。
   */
  setSandboxStatus: (sandboxId: string, status: string, patch?: SandboxStatusPatch) => void;
  /** 应用一条 /events 事件（sandbox.* 投影到本表）。 */
  applySandboxEvent: (event: SandboxEvent) => void;
  /** 移除条目（沙箱销毁/重试复位）。 */
  clearSandboxStatus: (sandboxId: string) => void;
}

export const createSandboxStatusSlice: StateCreator<
  SandboxStatusSlice,
  [],
  [],
  SandboxStatusSlice
> = (set) => ({
  sandboxStatuses: {},
  runtimeInstalls: {},
  setSandboxStatus: (sandboxId, status, patch): void => {
    set((s) => ({
      sandboxStatuses: {
        ...s.sandboxStatuses,
        [sandboxId]: {
          status,
          phase: patch?.phase,
          failureCode: patch?.failureCode,
          failureMessage: patch?.failureMessage,
        },
      },
      // 显式写入非 failed 状态 → 顺带清掉装 CLI 的陈旧子文案（与事件路径同规则）。
      runtimeInstalls: INSTALL_TERMINAL_STATUSES.has(status)
        ? omitKey(s.runtimeInstalls, sandboxId)
        : s.runtimeInstalls,
    }));
  },
  applySandboxEvent: (event): void => {
    switch (event.event) {
      case 'sandbox.status_changed':
        set((s) => ({
          sandboxStatuses: {
            ...s.sandboxStatuses,
            [event.sandboxId]: {
              status: event.status,
              phase: event.phase,
              // 失败原因的**即时**通道：后端只在 status:'failed' 时带码，其余恒 undefined。
              // 与 DTO 的 failureCode 写同一个字段 ⇒ 单一来源，不会出现两处各渲染一份。
              failureCode: event.errorCode,
              // WS 帧不带自由文本细节（那只在 DTO 上）；这里显式置空，避免留下上一次的陈旧文案。
              failureMessage: undefined,
            },
          },
          // 转入终态即清除装 CLI 子文案（进度卡已退出，留着会在失败卡/终端旁挂一句陈旧文案）。
          runtimeInstalls: INSTALL_TERMINAL_STATUSES.has(event.status)
            ? omitKey(s.runtimeInstalls, event.sandboxId)
            : s.runtimeInstalls,
        }));
        break;
      case 'runtime.install_progress':
        // 只投影到本表，**绝不碰 sandboxStatuses**（装 CLI 期间 status 恒为 starting，
        // 由这条事件去改状态会伪造出一次不存在的状态机转移）。
        // ⚠️ **不取 event.errorCode**：install_progress 不是失败兜底通道（10 §3.1 明写）。
        // 失败原因的唯一来源是 status_changed.errorCode / DTO.failureCode——
        // 这样 INSTALL_FAILED 虽有两条事件经过前端，也只会被渲染一次，不会互相打架。
        set((s) => ({
          runtimeInstalls: {
            ...s.runtimeInstalls,
            [event.sandboxId]: {
              runtime: event.runtime,
              status: event.status,
              versionDetected: event.versionDetected,
            },
          },
        }));
        break;
      case 'sandbox.created':
        // 首次可见：若尚无条目，落一个 pending 占位（status_changed 随后覆盖）。
        set((s) =>
          s.sandboxStatuses[event.sandboxId] !== undefined
            ? s
            : {
                sandboxStatuses: { ...s.sandboxStatuses, [event.sandboxId]: { status: 'pending' } },
              },
        );
        break;
      case 'sandbox.removed':
        set((s) => ({
          sandboxStatuses: omitKey(s.sandboxStatuses, event.sandboxId),
          runtimeInstalls: omitKey(s.runtimeInstalls, event.sandboxId),
        }));
        break;
      // waiting_input / clone_progress / runtime-auth：生命周期门不消费，忽略。
      default:
        break;
    }
  },
  clearSandboxStatus: (sandboxId): void => {
    set((s) => ({
      sandboxStatuses: omitKey(s.sandboxStatuses, sandboxId),
      runtimeInstalls: omitKey(s.runtimeInstalls, sandboxId),
    }));
  },
});
