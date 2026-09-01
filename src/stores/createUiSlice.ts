// UI slice（15 §3.1.1）：选中上下文、任务树折叠、瞬时指向、横幅抑制。
// action 为纯记账逻辑；store 保持"哑"（15 §3.2）。
//
// ★ 本轮（F21-2 §N.0 / F21-6 §9.4）删掉了「两步向导壳」的全部残骸：
//  · `WizardData` / `wizardData` / `setWizardData` / `wizardReturn` —— 全仓无人 set、无人读的死值。
//    向导本身从未被实现（F21-2 §3：20 个组件里 15 个不存在），它们是那个壳留下的化石；
//    §9.0 定案「两个新建弹窗彼此独立、不嵌套」之后，连回程语义都不存在了。
//  · `currentModal` 的 `'registerImage'` / `'wizard'` 两个取值 —— 同样是死值。
//    ⚠️ **`'registerImage'` 于 2026-08 镜像切片落地时加了回来**，而且是按 F21-4 §2 的
//    「加回来的两个条件」加的：① **set 与 read 一起落地**（`hooks/image/useImages.ts` 里
//    `openRegister()` set、`registerOpen` read，`ImagesContainer` 据此渲染），不是只加一个
//    联合成员——只在类型里存在的取值比没有更坏，它让人以为弹窗接好了；② **是真 overlay**
//    （`RegisterImageModal.view` 的 `role=dialog` + `fixed inset-0 z-50 … bg-black/60`，
//    与 `ConfirmDialog.view` 同一套形态）。`'wizard'` 仍然是死值，**没有加回来**。
//
// ⚠️ **指令类字段一个都不许回到这里**：`wizardData.initialPrompt` 曾是 store 上唯一
// 承载任务指令的字段，它现在被删掉不是"放宽"，恰恰相反 —— 指令只活在 container 的
// 局部 state（15 §3.5 安全红线），store 上连一个能装它的位置都不该有。
import type { StateCreator } from 'zustand';

/**
 * Git 凭证回程载体（15 §3.1.1）：clone 权限失败 → 跳凭证页配置 → 配完回创建处 [重试克隆]。
 * projectId 来自 POST /api/projects 的 202（后端先落库再异步 clone），故回程调 retry-clone，永不重新 create。
 * ⚠️ 绝不 persist（未纳入白名单）：它承载的是**本次创建流程**的回程指向，含内部仓库 URL。
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
  /**
   * 当前跟踪的无头 Task id（S6）。**与 selectedSandboxId 完全同一性质**：不透明 id、非机密、
   * 唯一作用是刷新后知道"该重新订阅哪条流"（凭 taskId + fromSeq 恢复，而不是重新拉全量）。
   *
   * 为什么值得进 persist 白名单（安全红线文件里加一项必须给得出理由）：
   * `GET /api/sandboxes/:id/tasks` **已经存在**且是刷新恢复的权威来源，但它只回一份列表，
   * 回答不了"用户上次盯着的是**哪一个**"。没有这一位，同一沙箱下有多个任务时刷新只能靠
   * 「回落到仍在跑的那个」猜——用户盯着 A 的输出，刷新后被换成 B，或者一个已结束的任务
   * 干脆回不去。所以 persist 的是**用户的选择**，不是服务端数据的副本（后者永远从列表取）。
   * 列表校验兜住了它变陈旧的情况（见 hooks/useAgentTask 的 reconcileTaskId）。
   * ⚠️ 只存 id：指令（prompt）与任何输出**绝不进 store**（15 §3.5 安全红线）。
   */
  selectedTaskId: string | null;
  /**
   * **第一次观察到当前选中的沙箱进入终态**（failed / stopped / destroyed）的时刻。
   *
   * 为什么需要它：`selectedSandboxId` 存活于 localStorage、跨会话不失效,于是几小时前
   * 的一条失败沙箱会在页面一加载就被 `useSandboxRestore` 捞回来渲染成失败卡,而界面上
   * **没有任何线索**说明那是旧记录——它看起来就是"我刚才那次操作失败了"。实际踩到过:
   * 旧记录的任务名与用户新输的指令一字不差,连名字都对得上。
   *
   * 为什么不能用"选中时刻"当判据:一个跑了 3 小时才失败的任务,用户在失败后 1 分钟刷新,
   * 按选中时刻算早已超期——那恰好是这个刷新恢复特性**唯一该服务的场景**。要判的是
   * "失败发生在多久以前",不是"选中发生在多久以前"。
   *
   * 为什么不由后端给:`SandboxDtoSchema` 没有时间戳,而 `updated_at` 只存在于持久化层、
   * 聚合根并不暴露它。为这一件事把持久化时间戳提进领域层,代价不对等。
   *
   * ⚠️ **残余缺口(已知,不是疏忽)**:这个戳记的其实是"**本标签页第一次看到**这条
   * 失败"，只有在标签页从失败发生那一刻起就一直开着时,它才等于"失败发生在多久
   * 以前"。于是在这个特性瞄准的场景里——关掉标签页、几小时后回来——**冷启动第一次
   * 仍会显示幽灵卡**:此前没人观测过那次转变,戳在恢复的这一刻才第一次落下,要等
   * 下一次打开(30 分钟之后)TTL 才生效。
   *
   * 真正的修法是后端在 `SandboxDto` 上给一个 `updatedAt`,前端改读它。那是跨仓改动
   * (契约 + mapper + 聚合根暴露持久化时间戳 + openapi 重出),已登记待排期;
   * 在那之前这一位把"同一会话内反复看到旧卡"这个高频场景解决掉,并把上面这条缺口
   * 明写在这里,而不是让它藏在"看起来修好了"的表象后面。
   *
   * **只在从 null 变为有值时写一次**:每次冷启动 `useSandboxRestore` 都会重新种子状态,
   * 若每次都刷新这个戳,时钟永远归零、也就永远不会过期。
   */
  selectedSandboxTerminalAt: number | null;
  sidebarCollapsed: boolean;
  setSelectedSandboxId: (id: string | null) => void;
  setSelectedProjectId: (id: string | null) => void;
  setSelectedTaskId: (id: string | null) => void;
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
  /**
   * 组头「⋯」指向的项目（F21-6 §5「组头「⋯」→ 侧弹层」）。
   *
   * ⚠️ **与 `selectedProjectId` 语义分离、绝不复用**：打开 B 的项目菜单**不改**当前
   * 工作项目（§9.2 VS-2 步骤 1）。此前这个字段只有声明、没有 setter，全仓无人写——
   * 与文件头那条「只在类型里存在的取值比没有更坏」是同一个病；本轮 set 与 read
   * 一起落地（`WorkbenchContainer` set，同一个 container 的 `overlaySlot` read）。
   */
  selectedProjectForMenu: string | null;
  setSelectedProjectForMenu: (projectId: string | null) => void;
  /**
   * 当前打开的**弹层**。三个取值都是真 overlay（`role=dialog` + `fixed inset-0 z-50 … bg-black/60`,
   * 与 `ConfirmDialog.view` 同一套形态），名字自此兑现。
   *
   * ⚠️ 在此之前这个名字是**假的**：`'createProject'` 被 `WorkbenchContainer` return 成
   * `mainContent`，是主区换页而不是弹层；而 `'wizard'` / `'registerImage'` 全仓无人 set、
   * 无人读（F21-2 §N.0）。上一轮两个「新建」都改成真弹层、形态对称，死值一并删除。
   *
   * ⚠️ `'registerImage'` 本轮**连 set 带 read 一起**加了回来（理由见文件头）：
   * `hooks/image/useImages.ts` set，`containers/image/ImagesContainer.tsx` read 并渲染
   * `RegisterImageModal.view`。`'wizard'` 没有回来——它今天仍然没有产出方。
   *
   * ⚠️ `'retainedVolumes'`（F21-6 §3.3「🎁 已保留卷」）按**同样两个条件**加入：
   * ① set 与 read 一起落地——`ProjectInfoBar.view` 的 [🎁 已保留卷] 经 `WorkbenchContainer`
   *    set，同一个 container 的 `overlaySlot` read 并渲染 `RetainedVolumesContainer`；
   * ② 是真 overlay（复用 `ModalShell.view`，与另外三个同一套形态）。
   *
   * ⚠️ `'automations'`（F21-7「⚙️ 自动化规则」）按**同样两个条件**加入：
   * ① set 与 read 一起落地——`ProjectInfoBar.view` 的 [⚙️ 自动化规则] 经 `WorkbenchContainer`
   *    set，同一个 container 的 `overlaySlot` read 并渲染 `AutomationsPanelContainer`；
   * ② 是真 overlay（同样复用 `ModalShell.view`）。
   *    ⚠️ 面板内部的「列表 ⇄ 详情 ⇄ 表单」是**视图切换，不是第二层弹层**
   *    （P20 §8.4 modal 不堆叠 / F21-7 §2），所以这里仍然只需要一个取值。
   *
   * ⚠️ `'projectMenu'`（F21-6 §10「项目菜单整块」）按**同样两个条件**加入：
   * ① set 与 read 一起落地——`ProjectGroupHeader.view` 的组头「⋯」→ `ProjectGroupMenu.view`
   *    经 `WorkbenchContainer` set（连同 `selectedProjectForMenu`），同一个 container 的
   *    `overlaySlot` read 并渲染 `ProjectMenuContainer`；
   * ② 是真 overlay（同样复用 `ModalShell.view`）。
   *    ⚠️ 面板内的「详情 ⇄ 删除确认」同样是**视图切换，不是第二层弹层**：
   *    `DeleteProjectConfirm.view` 就地渲染在面板内，不再叠一层 `fixed inset-0`
   *    （理由见该 view 的文件头）。
   *    ⚠️ 「已保留卷」/「自动化规则」两个入口本轮从 `ProjectInfoBar` 搬进本面板，
   *    点它们是 `currentModal` **换值**（本面板随之关闭），仍然不堆叠。
   */
  currentModal:
    | 'createProject'
    | 'newTask'
    | 'registerImage'
    | 'retainedVolumes'
    | 'automations'
    | 'projectMenu'
    | null;
  setCurrentModal: (modal: UiSlice['currentModal']) => void;

  // —— Git 凭证回程暂存（不 persist）——
  pendingProjectCreate: PendingProjectCreate | null;
  setPendingProjectCreate: (pending: PendingProjectCreate | null) => void;

  // —— 全局横幅 [重新检测] → 系统状态页的一次性指向（不 persist）——
  /**
   * 「进了系统状态页就自动跑一轮诊断」的**瞬时意图位**（F21-5 §2 从横幅 [诊断] 进入）。
   *
   * ⚠️ **绝不 persist**：它是一次点击的意图，不是用户偏好。落盘之后每一次冷启动打开
   * 系统状态页都会自动发起一轮 3×5s 的出网探测，而没有任何人点过任何东西。
   *
   * ⚠️ 生产方（`GlobalBannerContainer`）与消费方（`useSystemStatus`）**同一轮落地**——
   * 与 `currentModal` 那两个死值的教训同源（见文件头）。
   */
  diagnoseAutorunRequested: boolean;
  requestDiagnoseAutorun: () => void;
  clearDiagnoseAutorun: () => void;

  // —— 横幅抑制记录（persist：仅抑制记录）——
  bannerDismissedToday: Record<string, string>;
  /** 记下"选中的这条已进入终态"的时刻;**已经有戳就不覆盖**(理由见字段注释)。 */
  markSelectedSandboxTerminal: () => void;
  dismissBannerToday: (bannerId: string, day: string) => void;
}

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set) => ({
  selectedSandboxId: null,
  selectedProjectId: null,
  selectedTaskId: null,
  selectedSandboxTerminalAt: null,
  sidebarCollapsed: false,
  setSelectedSandboxId: (id): void => {
    // 换一条(或清空)选中 ⇒ 上一条的终态时刻立即作废,否则新选中的沙箱会继承旧的时钟。
    set({ selectedSandboxId: id, selectedSandboxTerminalAt: null });
  },
  markSelectedSandboxTerminal: (): void => {
    set((st) =>
      st.selectedSandboxTerminalAt === null ? { selectedSandboxTerminalAt: Date.now() } : {},
    );
  },
  setSelectedProjectId: (id): void => {
    set({ selectedProjectId: id });
  },
  setSelectedTaskId: (id): void => {
    set({ selectedTaskId: id });
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
  setSelectedProjectForMenu: (projectId): void => {
    // ⛔ 刻意**不动** selectedProjectId：两位分开正是 §9.2 VS-2 步骤 1 要的。
    set({ selectedProjectForMenu: projectId });
  },
  currentModal: null,
  setCurrentModal: (modal): void => {
    set({ currentModal: modal });
  },

  pendingProjectCreate: null,
  setPendingProjectCreate: (pending): void => {
    set({ pendingProjectCreate: pending });
  },

  diagnoseAutorunRequested: false,
  requestDiagnoseAutorun: (): void => {
    set({ diagnoseAutorunRequested: true });
  },
  clearDiagnoseAutorun: (): void => {
    set({ diagnoseAutorunRequested: false });
  },

  bannerDismissedToday: {},
  dismissBannerToday: (bannerId, day): void => {
    set((s) => ({ bannerDismissedToday: { ...s.bannerDismissedToday, [bannerId]: day } }));
  },
});
