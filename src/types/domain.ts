// 前端消费的领域视图类型（28 前端类型设计）。REST 权威形状来自 generated/openapi.d.ts；
// 这里是分组树等派生逻辑需要的最小手写投影，脚手架期先行，后端契约落地后逐步以生成类型替换。

/** Task（sandbox）的 6 个用户可见状态（P21 §2.1）。 */
export type SandboxStatus =
  'preparing' | 'running' | 'waiting-input' | 'paused' | 'error' | 'stopped';

export interface Project {
  id: string;
  name: string;
  cloneStatus?: 'ok' | 'cloning' | 'failed';
}

export interface Sandbox {
  id: string;
  projectId: string;
  name: string;
  status: SandboxStatus;
  /** running 的子态：等待用户输入（10 §7.4 派生字段 waitingInput）。 */
  waitingInput: boolean;
  lastActiveAt: number;
}

/** selectProjectTaskTree 的派生输出（15 §5）。 */
export interface ProjectGroup {
  projectId: string;
  projectName: string;
  cloneStatus: Project['cloneStatus'];
  collapsed: boolean;
  tasks: Sandbox[];
}
