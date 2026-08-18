// UI slice（15 §3.1.1）：选中上下文、任务树折叠、瞬时指向、向导往返暂存、横幅抑制。
// action 为纯记账逻辑；store 保持"哑"（15 §3.2）。
import type { StateCreator } from 'zustand';

export interface WizardData {
  runtime?: string;
  selectedProjectId?: string;
  image?: string;
  initialPrompt?: string; // ⚠️ 仅内存，绝不 persist（15 §3.5 安全红线）
}

/**
 * Git 凭证回程载体（15 §3.1.1）：clone 权限失败 → 跳凭证页配置 → 配完回创建处 [重试克隆]。
 * projectId 来自 POST /api/projects 的 202（后端先落库再异步 clone），故回程调 retry-clone，永不重新 create。
 * ⚠️ 绝不 persist（未纳入白名单）：与 wizardReturn 语义分离（前者管配凭证回程，后者管创建后回向导确认步）。
 */
export interface PendingProjectCreate {
  projectId: string;
  name: string;
  source: 'git' | 'empty';
  url?: string;
}

export interface UiSlice {
  // —— 选中上下文（persist）——
  selectedSandboxId: string | null;
  selectedProjectId: string | null;
  sidebarCollapsed: boolean;
  setSelectedSandboxId: (id: string | null) => void;
  setSelectedProjectId: (id: string | null) => void;
  toggleSidebar: () => void;

  // —— 任务树（persist）——
  taskListFolds: Record<string, boolean>;
  toggleProjectFold: (projectId: string) => void;
  expandProject: (projectId: string) => void;

  // —— 字号/记忆（persist）——
  terminalFontSize: number;
  lastUsedRuntime: string | null;
  lastUsedImage: string | null;
  setTerminalFontSize: (size: number) => void;

  // —— 瞬时 UI 指向（不 persist）——
  selectedProjectForMenu: string | null;
  currentModal: 'createProject' | 'registerImage' | 'wizard' | null;
  setCurrentModal: (modal: UiSlice['currentModal']) => void;

  // —— 向导往返暂存（wizardData.initialPrompt 不 persist）——
  wizardReturn: boolean;
  wizardData: WizardData | null;
  setWizardData: (data: WizardData | null) => void;

  // —— Git 凭证回程暂存（不 persist）——
  pendingProjectCreate: PendingProjectCreate | null;
  setPendingProjectCreate: (pending: PendingProjectCreate | null) => void;

  // —— 横幅抑制记录（persist：仅抑制记录）——
  bannerDismissedToday: Record<string, string>;
  dismissBannerToday: (bannerId: string, day: string) => void;
}

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set) => ({
  selectedSandboxId: null,
  selectedProjectId: null,
  sidebarCollapsed: false,
  setSelectedSandboxId: (id): void => {
    set({ selectedSandboxId: id });
  },
  setSelectedProjectId: (id): void => {
    set({ selectedProjectId: id });
  },
  toggleSidebar: (): void => {
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }));
  },

  taskListFolds: {},
  toggleProjectFold: (projectId): void => {
    set((s) => ({
      taskListFolds: { ...s.taskListFolds, [projectId]: !(s.taskListFolds[projectId] ?? false) },
    }));
  },
  // 深链/跨项目点击/指示器定位三条路径共用（15 §3.1.1 纪律 1）
  expandProject: (projectId): void => {
    set((s) => ({
      selectedProjectId: projectId,
      taskListFolds: { ...s.taskListFolds, [projectId]: false },
    }));
  },

  terminalFontSize: 14,
  lastUsedRuntime: null,
  lastUsedImage: null,
  setTerminalFontSize: (size): void => {
    set({ terminalFontSize: size });
  },

  selectedProjectForMenu: null,
  currentModal: null,
  setCurrentModal: (modal): void => {
    set({ currentModal: modal });
  },

  wizardReturn: false,
  wizardData: null,
  setWizardData: (data): void => {
    set({ wizardData: data });
  },

  pendingProjectCreate: null,
  setPendingProjectCreate: (pending): void => {
    set({ pendingProjectCreate: pending });
  },

  bannerDismissedToday: {},
  dismissBannerToday: (bannerId, day): void => {
    set((s) => ({ bannerDismissedToday: { ...s.bannerDismissedToday, [bannerId]: day } }));
  },
});
