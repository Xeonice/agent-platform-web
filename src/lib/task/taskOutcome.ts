// 无头 Task 终态呈现（纯函数，可单测）。P22 §1 的两条原则在这里落地：
//  ① 错误**永远是码不是句子** ⇒ 前端按码渲染人话，缺码走兜底，绝不裸抛码；
//  ② **`exitCode` 可能缺席**（被信号杀掉的进程没有退出码）⇒ 缺席按非零退出处理并说明原因，
//     **绝不把 `undefined` 渲染到界面上**。
import type { TaskErrorCode, TaskStatus } from '@/types/task';
import type { TaskExit, TaskOutcomeCopy } from '@/types/taskStream';

// 形状住在 types/（view 层不能 import lib）；本文件只产出内容。
export type { TaskOutcomeCopy } from '@/types/taskStream';

/**
 * **任务终态**的错误码 → 人话。闭集来自生成类型（`AgentTaskResponseDto['errorCode']`，
 * 后端 zod enum），用 `satisfies Partial<Record<TaskErrorCode, string>>` 咬死：
 * **拼错一个 key、或后端删掉一个码，当场 tsc 红**——那正是当初 `TASK_TIMEOUT`（少 `_ED`）
 * 那一类永远匹配不上的死条目。
 *
 * 为什么是 `Partial` 而不是完整 `Record`：完整 `Record` 会强制给全部 15 个码写文案，
 * 与下面「刻意不收录」那条设计冲突。**"后端加了新码而前端没跟上"这个方向由
 * `taskOutcome.test.ts` 里的穷举决策表兜住**：那张表是完整 `Record<TaskErrorCode, …>`，
 * 后端加一个码 ⇒ 它缺 key ⇒ 编译失败 ⇒ 逼你为新码做一次显式决策（写文案，还是放行后端句子）。
 *
 * 收录标准：**码本身就说清了发生什么、且用户据此能行动**。
 * ⚠️ **刻意不收录** `INVALID_STATE` / `NOT_FOUND` / `ALREADY_EXISTS` / `PERMISSION_DENIED`：
 * 这四个必须由后端 message 指名道姓才有意义（"sandbox X was provisioned for runtime
 * 'codex', not 'claude-code'"），收录了反而把那句话盖掉。未收录 ⇒ 返回 `undefined`，
 * **兜底交给各调用点自己的语境**（发起失败 / 终止失败 / 任务结束是三件事）。
 *
 * ⚠️ 「放行后端 message」这个选项**并非处处都存在**——这是给下一个人的提醒：
 * 本表的两个消费者里，只有 `useTaskErrorMessage`（REST 错误信封）手上有 message；
 * `describeTaskOutcome` 拿到的**只有码**（`AgentTaskResponseDto` 里根本没有自由文本字段）。
 * 所以对一个**会以任务终态出现**的码选"不收录"，等于选了那句"平台暂未收录的原因"兜底——
 * 见下面 `UNKNOWN_RUNTIME` 的决策注释。
 *
 * 已删掉的三条死条目（S6 集成审查）：`AUTH_REQUIRED` / `AUTH_EXPIRED` / `INSTALL_FAILED`。
 * 前两个后端全仓零产出（`auth-required` **事件**另有自己的内联文案，走的不是这张表）；
 * `INSTALL_FAILED` 是真码但长在**沙箱**那条线上，文案早就在 `lib/sandboxErrorCopy.ts` 里。
 * 三条都不在 `AgentTaskErrorCode` 闭集内 ⇒ 和 `TASK_TIMEOUT` 是同一类东西。
 */
const TASK_ERROR_COPY = {
  // —— 正常终态（`'TASK_' + status.toUpperCase()`，succeeded 没有 errorCode）——
  TASK_FAILED: '任务以失败告终（CLI 非零退出或运行途中报错）。可以看上方输出定位原因后重跑。',
  TASK_KILLED:
    '任务已被终止（你点了「终止任务」，或平台执行了强杀）。本轮不可恢复，可以重新发起一轮。',
  TASK_TIMED_OUT: '任务运行超过设定的硬超时上限，已被平台强制终止。可以调大超时档位后重跑。',
  // —— 平台侧恢复路径 ——
  SANDBOX_GONE:
    '任务运行期间沙箱消失了（被停止/删除，或容器自己退出），本轮无法继续。确认沙箱在运行后重跑。',
  RESUME_FAILED:
    '平台重启后没能重新接上这个任务，已按失败落库（它不会再有新输出了）。上方是中断前已收到的部分；可以用本轮会话接着聊，或重新发起一轮。',
  /**
   * B2 新增码（后端不再把它复用成 `INSTALL_FAILED`）。**收录**，理由三条：
   *
   * ① **它真的会以任务终态出现，而那条路上没有后端 message 可放行。**
   *    后端自己的用例把这个场景写死了：任务行熬过了平台重启，而注册该 adapter 的
   *    out-of-tree 模块没有再加载 ⇒ `runtimes.get(task.runtime)` 抛错，任务落 `failed` +
   *    本码。此时前端手上**只有码**（DTO 无自由文本字段），"不收录"＝用户看到的是
   *    "任务以一个平台暂未收录的原因结束"——而这恰恰是后端刚刚修掉的那件事
   *    （它不再让一个自己精确知道的事实退化成 INSTALL_FAILED / INTERNAL），前端不该在上一层重演。
   * ② **码本身就说清了发生什么**：这个 runtime 不在注册表里。后端 message 唯一多出来的
   *    具体信息是 runtime id，而它本来就显示在界面上（沙箱 DTO 上带着）——
   *    与 `INVALID_STATE` 那四个"message 里才有关键对象"的情况不同。
   * ③ **用户据此能行动，而且行动方向与默认直觉相反**：后端把它标成 `retryable: false`，
   *    重跑同一个 runtime 必然再失败一次。这正是需要一句话说清楚的场合。
   *
   * ⚠️ 创建入口那条 400 走的是**另一张表**（`lib/sandboxErrorCopy.ts`），那边有后端 message
   * 可放行，故不在此处收录范围内——两条路各自的语境不同，别合并。
   */
  UNKNOWN_RUNTIME:
    '这个任务的 runtime 已不在平台的注册表里，本轮无法继续（常见于随第三方模块注册的 runtime：平台重启后该模块没有再加载）。重跑同一个 runtime 只会再失败一次——请装回该模块，或改用注册表里仍有的 runtime 重新发起。',
  // —— provider 契约错误里"码本身就说清了"的那些 ——
  IMAGE_PULL_FAILED: '镜像拉取失败，任务未能开始。确认镜像名与镜像仓库凭证后重试。',
  /**
   * 本轮随镜像切片进入 `AgentTaskErrorCode` 闭集（10 §6.8 主表）。**决策：copy。**
   *
   * ① 这条路上没有后端 message 可放行——`AgentTaskResponseDto` 没有自由文本字段，
   *    "不收录"＝用户看到"一个平台暂未收录的原因"，而这个码恰恰是**最说得清**的一种失败。
   * ② 用户该做的事与直觉相反：地址没错、重跑也没用（拉的还是那个已不存在的 digest），
   *    出路是去镜像管理点 [检查更新]。不写这句，界面只会诱导他再跑一遍。
   * ③ ⚠️ 与 `lib/sandbox/sandboxErrorCopy.ts` 里的同名码**不是重复**：那边是"创建请求失败"
   *    的语境（失败卡 + 出路按钮），这里是"任务已经结束了"的语境。同一个事实、两个时刻，
   *    合并会让其中一句在另一条路上说假话（`UNKNOWN_RUNTIME` 上面那条注释是同一个道理）。
   */
  IMAGE_DIGEST_GONE:
    '这个任务要用的镜像版本在仓库里已经不存在了，任务未能开始。镜像地址没有错——平台按注册时钉定的 digest 拉取，而上游删除或回收了那个版本。**重跑没有用**：去设置 → 镜像管理对这张镜像点 [检查更新]，换到新版本后再重新发起。',
  RESOURCE_EXHAUSTED: '资源暂时不足，任务未能完成。释放部分任务后重试。',
  TIMEOUT:
    '与容器运行时的一次操作超时，任务被中断（这不是你设的硬超时档位）。稍后重试；持续如此请查看系统状态。',
  PROVIDER_UNAVAILABLE: '容器运行时无响应，任务被中断。确认容器服务已启动后重试。',
  UNSUPPORTED_CAPABILITY:
    '当前沙箱的运行档位不支持无头任务（provider 能力位 headlessTask=false）。请换一个支持的档位重建沙箱。',
  INTERNAL: '平台内部错误导致任务中断。可以重跑一次；持续失败请查看系统状态。',
} satisfies Partial<Record<TaskErrorCode, string>>;

/**
 * **事件通道**（`{type:'error', code}` 帧）的码 → 人话。与上面的终态表分开是刻意的：
 * 通道报错时任务**根本没结束**，套一句"任务以…原因结束"就是在说假话。
 *
 * `UNAUTHORIZED` / `SCHEMA_MISMATCH` 是给后端预留的接收侧：今天后端在 `handleConnection` 里
 * 直接 `disconnect(true)`，客户端只看得到普通 disconnect（详见 services/ws/taskSocket.ts 头注释），
 * 一旦后端改成断开前先发一帧 error，这里就已经接得住。
 */
const TASK_CHANNEL_ERROR_COPY: Record<string, string> = {
  NOT_FOUND: '事件通道找不到这个任务（可能已被平台清理），无法再接收它的输出。',
  REPLAY_FAILED: '历史输出回放失败，下方内容可能不完整；重连或刷新可以再试一次。',
  UNAUTHORIZED: '事件通道未通过口令校验，解锁后才能继续接收输出。',
  SCHEMA_MISMATCH: '事件通道协议版本与后端不一致（前端不是最新的），请刷新页面后重试。',
};

/**
 * **任务终态**错误码的人话。
 *
 * ⚠️ 未收录时返回 `undefined`（而不是一句放之四海的兜底）——三个调用点的语境完全不同：
 * 发起失败要透出后端那句具体的话、终止失败是另一件事、任务结束才轮到"以某原因结束"。
 * 早先这里对任何非空码都返回值，三处调用点写好的 `?? 兜底` 全成了死代码。
 */
export function describeTaskErrorCode(code: string | undefined): string | undefined {
  if (code === undefined || code === '') return undefined;
  // 形参**刻意是宽的 string**：调用点之一是 REST 错误信封的 `code`，它的取值域比
  // `TaskErrorCode` 更宽（还包括别的模块的码）。收窄形参只会把那条路逼去做类型断言，
  // 而这里只要一次**加宽**赋值（不是断言）就够了。
  const lookup: Readonly<Record<string, string | undefined>> = TASK_ERROR_COPY;
  return lookup[code];
}

/** **事件通道**错误码的人话；未收录返回 `undefined`，由调用点给通道语境的兜底。 */
export function describeTaskChannelErrorCode(code: string | undefined): string | undefined {
  if (code === undefined || code === '') return undefined;
  return TASK_CHANNEL_ERROR_COPY[code];
}

/**
 * 通道级码的闭集**不是** `TaskErrorCode`，所以上面那张表不参与 `satisfies` 咬合：
 * 它的取值来自 `tasks.gateway`（NOT_FOUND / REPLAY_FAILED）与握手中间件
 * （UNAUTHORIZED / SCHEMA_MISMATCH），后端没有把它们收成 enum 进 openapi。
 * 真要咬合得等后端也给通道码出一份闭集——在那之前，`taskSocket.test.ts` /
 * `taskStream.test.ts` 里的用例是这四个码唯一的看守。
 */

const STATUS_TITLE: Record<TaskStatus, string> = {
  running: '任务进行中',
  succeeded: '✅ 任务完成',
  failed: '❌ 任务失败',
  killed: '⛔ 任务被终止',
  timed_out: '⏱️ 任务超时，已被强制终止',
};

/**
 * 终态呈现。`exit.exitCode` 缺席时：
 *   · tone 一律 failed（"按非零退出处理"）；
 *   · exitCodeLabel 给人话而不是 undefined；
 *   · advice 里解释"为什么没有退出码"，避免用户以为是前端丢了字段。
 */
export function describeTaskOutcome(input: {
  exit: TaskExit;
  errorCode?: string;
}): TaskOutcomeCopy {
  const { status, exitCode } = input.exit;
  const missing = exitCode === undefined;
  const success = status === 'succeeded' && exitCode === 0;

  const exitCodeLabel = missing ? '未知（进程被信号终止，没有退出码）' : String(exitCode);

  const parts: string[] = [];
  const hasCode = input.errorCode !== undefined && input.errorCode !== '';
  const codeCopy = describeTaskErrorCode(input.errorCode);
  if (codeCopy !== undefined) parts.push(codeCopy);
  // 有码但没收录：兜底句只属于**这一个**语境（任务确实结束了），不再由 describeTaskErrorCode 代劳。
  else if (hasCode) parts.push('任务以一个平台暂未收录的原因结束；下方诊断码可提供给管理员排查。');
  if (missing) {
    parts.push(
      '本次没有拿到退出码——进程被信号终止（超时强杀 / OOM / 手动终止）时不会留下退出码，已按非零退出处理。',
    );
  } else if (!success && exitCode !== 0) {
    parts.push(`CLI 以退出码 ${String(exitCode)} 结束。`);
  }
  if (parts.length === 0) {
    parts.push(
      success ? '产物可在下方列表下载；也可以基于这一轮会话接着提新指令。' : '可以调整指令后重跑。',
    );
  }

  return {
    tone: success ? 'success' : 'failed',
    exitCodeLabel,
    exitCodeMissing: missing,
    title: success ? '✅ 任务完成（退出码 0）' : STATUS_TITLE[status],
    advice: parts.join(' '),
    ...(input.errorCode === undefined || input.errorCode === ''
      ? {}
      : { diagnosticCode: input.errorCode }),
  };
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** 产物体积展示（二进制进位，最多一位小数）。 */
export function formatArtifactSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded} ${SIZE_UNITS[unit] ?? 'B'}`;
}

/**
 * 下载进度的人话（纯函数）。
 *
 * ⚠️ `totalBytes` **可能缺席**，而且缺席是正常路径而不是异常：产物响应的 `content-length`
 * 取决于后端有没有带（分块/压缩传输时它可以合法地不存在）。缺席时**只报已下载多少**，
 * 绝不去猜一个百分比 —— 猜出来的进度条是在骗人。这与 `exitCode` 缺席那条纪律同源。
 */
export function describeDownloadProgress(input: {
  receivedBytes: number;
  totalBytes?: number;
}): string {
  const received = formatArtifactSize(input.receivedBytes);
  const total = input.totalBytes;
  if (total === undefined || total <= 0) return `已下载 ${received}`;
  // 压缩传输时 content-length 是**压缩后**字节数、而流出来的是解压后的 ⇒ 可能超过 100%。
  // 夹住上界，宁可停在 100% 也不显示 137%。
  const percent = Math.min(100, Math.round((input.receivedBytes / total) * 100));
  return `已下载 ${received} / ${formatArtifactSize(total)}（${String(percent)}%）`;
}

/** 硬超时倒计时（纯函数，`now` 由调用方注入 ⇒ 可单测、无隐藏时钟）。 */
export interface TaskDeadlineView {
  /** 展示文本，如「还剩 1 小时 23 分」；超时后是「已超过硬超时预算…」。 */
  label: string;
  remainingMs: number;
  /** 已超预算：平台的两阶段强杀在路上，但还没落地。 */
  overdue: boolean;
}

function humanizeDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${String(hours)} 小时 ${String(minutes)} 分`;
  if (minutes > 0) return `${String(minutes)} 分 ${String(seconds)} 秒`;
  return `${String(seconds)} 秒`;
}

/**
 * 「还剩多久」。只有 `startedAt` 算得出"已经跑了多久"，算不出"还剩多久"——
 * 后者才是用户盯着一个可能跑 4 小时的任务时真正想知道的，所以 `timeoutMinutes` 是必填
 * （契约里它 required，前端不为一个必然存在的字段留降级分支，更**不猜默认档位**）。
 * `startedAt` 解析不出来时返回 null，免得渲染一个 NaN 倒计时。
 */
export function describeTaskDeadline(input: {
  startedAt: string;
  timeoutMinutes: number;
  now: number;
}): TaskDeadlineView | null {
  const started = Date.parse(input.startedAt);
  if (Number.isNaN(started)) return null;

  const remainingMs = started + input.timeoutMinutes * 60_000 - input.now;
  if (remainingMs <= 0) {
    return {
      label: '已超过硬超时预算，平台正在强制终止…',
      remainingMs,
      overdue: true,
    };
  }
  return { label: `还剩 ${humanizeDuration(remainingMs)}`, remainingMs, overdue: false };
}
