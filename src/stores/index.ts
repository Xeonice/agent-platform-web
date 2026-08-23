// slices 合并为单一 useAppStore（15 §3.1）。中间件只在顶层套一次。
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createUiSlice, type UiSlice } from '@/stores/createUiSlice';
import {
  createTerminalRegistrySlice,
  type TerminalRegistrySlice,
} from '@/stores/createTerminalRegistrySlice';
import { createAccessSlice, type AccessSlice } from '@/stores/createAccessSlice';
import {
  createSandboxStatusSlice,
  type SandboxStatusSlice,
} from '@/stores/createSandboxStatusSlice';
import { createProjectCloneSlice, type ProjectCloneSlice } from '@/stores/createProjectCloneSlice';

export type AppState = UiSlice &
  TerminalRegistrySlice &
  AccessSlice &
  SandboxStatusSlice &
  ProjectCloneSlice;

/** persist 落盘的字段形状（白名单产出）。用于把安全红线写成可回归的类型 + 快照。 */
export interface PersistedState {
  selectedSandboxId: string | null;
  selectedProjectId: string | null;
  /** S6 新增第 9 项：无头 Task 的刷新恢复指向（不透明 id，理由见 createUiSlice 的字段注释）。 */
  selectedTaskId: string | null;
  sidebarCollapsed: boolean;
  taskListFolds: Record<string, boolean>;
  bannerDismissedToday: Record<string, string>;
  terminalFontSize: number;
  lastUsedRuntime: string | null;
  lastUsedImage: string | null;
}

/**
 * persist 白名单（15 §3.5）：列举要存的，而不是排除不存的——新增字段默认不落盘。
 * 安全红线：wizardData.initialPrompt / pendingProjectCreate / 任何凭证 / terminal registry 绝不进此表。
 *
 * ⚠️ S6 把白名单从 8 项扩到 9 项（新增 `selectedTaskId`）。这**不是**放宽红线：
 * 红线管的是"指令 / 明文凭证 / 内部路径"这类内容，而 `selectedTaskId` 与既有的
 * `selectedSandboxId` 同型——不透明 id、非机密、纯选中指向。加它的理由是刷新恢复
 * （凭 taskId 重新 subscribe 带 fromSeq）在当前接缝下没有第二个来源。
 * 无头任务的 prompt 与输出仍然只在 container 局部 state / 内存 reducer，绝不落盘。
 */
export function partializeAppState(state: AppState): PersistedState {
  return {
    selectedSandboxId: state.selectedSandboxId,
    selectedProjectId: state.selectedProjectId,
    selectedTaskId: state.selectedTaskId,
    sidebarCollapsed: state.sidebarCollapsed,
    taskListFolds: state.taskListFolds,
    bannerDismissedToday: state.bannerDismissedToday,
    terminalFontSize: state.terminalFontSize,
    lastUsedRuntime: state.lastUsedRuntime,
    lastUsedImage: state.lastUsedImage,
  };
}

export const useAppStore = create<AppState>()(
  persist(
    (...args) => ({
      ...createUiSlice(...args),
      ...createTerminalRegistrySlice(...args),
      ...createAccessSlice(...args),
      ...createSandboxStatusSlice(...args),
      ...createProjectCloneSlice(...args),
    }),
    {
      name: 'agent-platform-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: partializeAppState,
    },
  ),
);
