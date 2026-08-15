// 沙箱运行时状态投影（10 §7.4）：keyed by sandboxId → { status, phase }。
// /events 通道 sandbox.status_changed 驱动；create 响应用于种子首值。
// ⚠️ 纯内存运行时态，不 persist（未纳入 partializeAppState 白名单）。
import type { StateCreator } from 'zustand';
import type { SandboxEvent } from '@/types/ws-protocol';

/** 返回去掉指定 key 的浅拷贝（避免 dynamic-delete / rest-siblings lint）。 */
function omitKey(
  map: Record<string, SandboxRuntimeState>,
  key: string,
): Record<string, SandboxRuntimeState> {
  return Object.fromEntries(Object.entries(map).filter(([k]) => k !== key));
}

export interface SandboxRuntimeState {
  /** 后端 12 值生命周期状态（自由字符串，运行时校验后透传）。 */
  status: string;
  /** 细分阶段（可选，来自 status_changed.phase）。 */
  phase?: string;
}

export interface SandboxStatusSlice {
  sandboxStatuses: Record<string, SandboxRuntimeState>;
  /** REST 种子/显式写入。 */
  setSandboxStatus: (sandboxId: string, status: string, phase?: string) => void;
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
  setSandboxStatus: (sandboxId, status, phase): void => {
    set((s) => ({
      sandboxStatuses: { ...s.sandboxStatuses, [sandboxId]: { status, phase } },
    }));
  },
  applySandboxEvent: (event): void => {
    switch (event.event) {
      case 'sandbox.status_changed':
        set((s) => ({
          sandboxStatuses: {
            ...s.sandboxStatuses,
            [event.sandboxId]: { status: event.status, phase: event.phase },
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
        set((s) => {
          if (s.sandboxStatuses[event.sandboxId] === undefined) return s;
          return { sandboxStatuses: omitKey(s.sandboxStatuses, event.sandboxId) };
        });
        break;
      // waiting_input / clone_progress / runtime-auth：S1 生命周期门不消费，忽略。
      default:
        break;
    }
  },
  clearSandboxStatus: (sandboxId): void => {
    set((s) => {
      if (s.sandboxStatuses[sandboxId] === undefined) return s;
      return { sandboxStatuses: omitKey(s.sandboxStatuses, sandboxId) };
    });
  },
});
