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
  /** 第 10 项:选中沙箱进入终态的时刻(见 createUiSlice 的字段注释)。数字,不是内容。 */
  selectedSandboxTerminalAt: number | null;
  sidebarCollapsed: boolean;
  taskListFolds: Record<string, boolean>;
  bannerDismissedToday: Record<string, string>;
  terminalFontSize: number;
  lastUsedRuntime: string | null;
  lastUsedImage: string | null;
}

/**
 * persist 白名单（15 §3.5）：列举要存的，而不是排除不存的——新增字段默认不落盘。
 * 安全红线：任何指令类字段 / pendingProjectCreate / 任何凭证 / terminal registry 绝不进此表。
 * （承载指令的 `wizardData` 本轮已从 store 上整个删除——见 createUiSlice 头注释。）
 *
 * ⚠️ 白名单 8 → 9（S6 `selectedTaskId`）→ 10（`selectedSandboxTerminalAt`）。都**不是**放宽红线：
 * 第 10 项是一个**时刻**,不含任何内容——它存在是因为"这条失败发生在多久以前"这件事
 * 后端 DTO 答不上来(没有时间戳),而没有它,几小时前的一条失败会在冷启动时伪装成
 * 用户刚才那次操作的结果。理由与红线的关系同下:
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
    selectedSandboxTerminalAt: state.selectedSandboxTerminalAt,
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
