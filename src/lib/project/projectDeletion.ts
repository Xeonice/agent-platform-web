// 删除项目的级联后果计算（纯函数，可单测）。F21-6 §10.6 第 3 条：
//
// ⛔ **运行中任务警示读的是真数据**。「可能有正在运行的任务」这种句子永远正确，
// 因而永远没用——它既不能让用户放心地删，也不能拦住一次误删。要说就说数字：
// 「含 2 个运行中任务将被强制停止」，0 个的时候也照样说出来（「当前没有运行中的任务」），
// 两个分支都由本函数的返回值决定，界面上没有第三条路。
import type { Sandbox, SandboxStatus } from '@/types/domain';

/**
 * 会被删除**强制停止**的 Task 状态。
 *
 * `paused` 不在内：它已经停了，删除它不构成"打断正在进行的工作"这条警示要说的事。
 * `error` / `stopped` 同理——它们本来就不在跑。
 * `preparing` 在内：容器/卷已经在建，删除同样是把一件进行中的事按掉。
 */
const RUNNING_STATUSES: ReadonlySet<SandboxStatus> = new Set<SandboxStatus>([
  'preparing',
  'running',
  'waiting-input',
]);

export function isRunningTask(status: SandboxStatus): boolean {
  return RUNNING_STATUSES.has(status);
}

/** 某项目下**正在运行**的 Task 数（projectId 为 null ⇒ 0，没有项目就没有可数的东西）。 */
export function countRunningTasks(tasks: readonly Sandbox[], projectId: string | null): number {
  if (projectId === null) return 0;
  return tasks.filter((task) => task.projectId === projectId && isRunningTask(task.status)).length;
}
