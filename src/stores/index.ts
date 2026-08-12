// slices 合并为单一 useAppStore（15 §3.1）。中间件只在顶层套一次。
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createUiSlice, type UiSlice } from '@/stores/createUiSlice';
import {
  createTerminalRegistrySlice,
  type TerminalRegistrySlice,
} from '@/stores/createTerminalRegistrySlice';

export type AppState = UiSlice & TerminalRegistrySlice;

/** persist 落盘的字段形状（白名单产出）。用于把安全红线写成可回归的类型 + 快照。 */
export interface PersistedState {
  selectedSandboxId: string | null;
  selectedProjectId: string | null;
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
 */
export function partializeAppState(state: AppState): PersistedState {
  return {
    selectedSandboxId: state.selectedSandboxId,
    selectedProjectId: state.selectedProjectId,
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
    }),
    {
      name: 'agent-platform-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: partializeAppState,
    },
  ),
);
