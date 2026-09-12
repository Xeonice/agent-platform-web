// 前端消费的领域视图类型（28 前端类型设计）。REST 权威形状来自 generated/openapi.d.ts；
// 这里是分组树等派生逻辑需要的最小手写投影，脚手架期先行，后端契约落地后逐步以生成类型替换。

/** Task（sandbox）的 6 个用户可见状态（P21 §2.1）。 */
export type SandboxStatus =
  'preparing' | 'running' | 'waiting-input' | 'paused' | 'error' | 'stopped';

export interface Project {
  id: string;
  name: string;
  /** 与后端 ProjectResponseDto.cloneStatus 同词汇：'ready' 就绪 / 'cloning' 克隆中 / 'failed' 失败。 */
  cloneStatus?: 'ready' | 'cloning' | 'failed';
  /** 展示用 Task 数，直传自后端 ProjectResponseDto.taskCount。 */
  taskCount?: number;
}

export interface Sandbox {
  id: string;
  projectId: string;
  name: string;
  status: SandboxStatus;
  /** running 的子态：等待用户输入（10 §7.4 派生字段 waitingInput）。 */
  waitingInput: boolean;
  lastActiveAt: number;
  /**
   * 任务树副行「活跃于 X 前」（design-notes.md §4 Phase 3 第 2 条 / 原型 `renderTaskTree()`）。
   * 由 `useProjectTaskTree` 基于 `lastActiveAt` 派生（`@/lib/project/taskActivity`）。
   *
   * ⚠️ **`undefined` ⇒ 调用方整段不渲染这一句**，⛔ 不许拿估算值顶替——今天
   * `useSandboxes` 把 `lastActiveAt` 硬编码成 `0`（后端 `SandboxDto` 还不带时间戳），
   * 这一位因此恒为 `undefined`，直到那个字段真的接上后端契约。
   */
  activityLabel?: string;
}

/**
 * 左侧任务树筛选 chips（P21-1 §6：产品文档定的六档口径——全部/准备中/运行中/等待输入/
 * 已暂停/异常）。design-notes.md 原型只画了四档（缺准备中、异常），已按产品文档裁决补齐
 * （F21-1 §9.1 #15 记录的偏离在这一轮收口）。
 *
 * ⚠️ `SandboxStatus` 还有第 6 个值 `'stopped'`，六档里**没有它的位置**——产品文档 §6
 * 给的六档本来就不含"已停止"，这不是本次遗漏，是文档口径本身的取舍（见
 * `filterTaskTree.ts` 顶部说明与 `filterProjectGroups` 用例里的显式验证）。
 */
export type TaskStatusFilter =
  'all' | 'preparing' | 'running' | 'waitingInput' | 'paused' | 'error';

/** selectProjectTaskTree 的派生输出（15 §5）。 */
export interface ProjectGroup {
  projectId: string;
  projectName: string;
  cloneStatus: Project['cloneStatus'];
  collapsed: boolean;
  /** 展示用 Task 数：后端 taskCount 优先，回退到已加载 tasks 数。 */
  taskCount: number;
  tasks: Sandbox[];
}
