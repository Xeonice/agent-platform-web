// 自动化规则领域类型（F21-7 / 10 §6.5 + §7.1/§7.3 / 13 §2.7）。
//
// **形状来自生成物**，与全站其它 REST 类型同源。
//
// ⚠️ 上一版是手写的（当时后端并行实现中、`openapi.json` 里还没有这些端点），文件头列了
// 三步待办；后端重导之后本轮补齐了第 2、3 步：类型改指 `components['schemas'][...]`，
// 每个 zod schema 挂 `satisfies z.ZodType<T>`。
//
// ⭐ **那道 `satisfies` 不是形式**：上锁当场就抓出两个已经漂掉的地方 ——
// `errorCode` 的取值前端只写了 2 个而契约有 3 个（少的那个 `RESOURCE_EXHAUSTED` 会让
// **整页运行历史解析失败、变成一句错误消息**），以及 webhook-test 的响应体前端从没读过。
// 两个都是「手写形状 + 无编译期保护」的必然产物，不是谁不小心。
//
// ⚠️ zod 不会因为生成类型到位就删掉——两者各管一头（retainedVolume.ts 文件头同一论证）：
// 生成类型是编译期兜底，zod 是运行时兜底（真实响应与契约不符时当场炸，而不是把 `undefined`
// 渲染成「耗时 NaN ms」）。
//
// ⏳ **三处契约缺口**，已在交付报告里列给后端（本文件按"UI 需要、契约暂缺"处理成 optional，
//    这样后端先发不带这些字段的版本时前端只是降级显示，而不是整个面板炸掉）：
//    · `AutomationRunDto.errorCode` —— 10 §7.3 的 `AutomationRunDto` **没有这个字段**，
//      而 03 §8.2 决策表第 1/2 行明确要求 `skipped` 带 `error_code`（`PREVIOUS_RUNNING` /
//      `AUTH_EXPIRED`），13 §2.7.2 表里也有这一列。没有它，界面上两种"跳过"就分不开，
//      而"因为凭证过期跳过"是要引导用户去重新授权的，"因为上次没跑完跳过"什么都不用做。
//    · `AutomationRunDto.sandboxId` —— [打开 Task] 要跳到哪个 Task，契约里没有出口。
//    · `AutomationDto.concurrencyMode` —— P21-7 §3.2 表单里有这一项（MVP 恒为 `skip`），
//      `CreateAutomationRequest` 里没有。本轮前端按"恒为 skip、不可改"渲染，不进 payload。

// ===== 枚举（逐字对齐 10 §7.1）=====

/**
 * 运行结果的 8 个取值（13 automation_runs）。
 *
 * ⚠️ **它们不是同一类东西**，这是本页最容易做错的地方：`failed`/`timeout` 是"规则真的跑挂了"，
 * `skipped`/`missed` 是"这次压根没跑"，`pending`/`running`/`resource-exhausted` 是"还没有结果"。
 * 判据在 P21-7 §4 的计数口径：**只有 `failed`（含 `timeout`）计入连续失败**。
 * 界面上的区分见 `lib/automation/formatRunOutcome`。
 */
import type { components } from '@/types/generated/openapi';

export const AUTOMATION_RUN_STATUSES = [
  'pending',
  'running',
  'success',
  'failed',
  'timeout',
  'resource-exhausted',
  'skipped',
  'missed',
] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

/** `skipped` 的两种原因（03 §8.2 决策表第 1/2 行）。⏳ 契约暂缺，见文件头。 */
// ⭐ **从契约推导，不手抄** —— 上一版手写了两个值，而契约有三个
// （少的是 `RESOURCE_EXHAUSTED`：决策表行 3 重试 5 次仍拿不到资源的终态，03 §8.2）。
// zod 的 `.optional()` 放过缺席、**放不过多一个合法取值** ⇒ 那种 run 一出现就让整页
// 运行历史解析失败、显示 0 行。手抄 enum 在这里是不可接受的。
export type AutomationSkipReason = NonNullable<
  components['schemas']['AutomationRunResponseDto']['errorCode']
>;
/** zod 要一个运行时数组；⚠️ 与上面的类型由 `Exact<>` 锁死，漏一个值编译期就红。 */
export const AUTOMATION_SKIP_REASONS = [
  'PREVIOUS_RUNNING',
  'AUTH_EXPIRED',
  'RESOURCE_EXHAUSTED',
] as const satisfies readonly AutomationSkipReason[];

export const WEBHOOK_STATUSES = ['sent', 'failed', 'skipped'] as const;
export type WebhookStatus = (typeof WEBHOOK_STATUSES)[number];

export const TRIGGER_ON_OPTIONS = ['failure', 'success', 'all'] as const;
export type TriggerOn = (typeof TRIGGER_ON_OPTIONS)[number];

export const SCHEDULE_KINDS = ['hourly', 'daily', 'weekly'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

/**
 * 硬超时档位。**刻意复用 `types/task` 的那一份**（`TASK_TIMEOUT_OPTIONS`），不在这里另抄一遍：
 * 自动化触发产生的就是标准无头 Task（P21-7 §9），两处档位天然同源，抄第二份就会漂。
 */
export { TASK_TIMEOUT_OPTIONS as AUTOMATION_TIMEOUT_OPTIONS } from '@/types/task';
export type { TaskTimeoutMinutes as AutomationTimeoutMinutes } from '@/types/task';

/** 成果保留期（10 §7.1 `ArtifactRetentionDays`）；默认 7 天。 */
export const ARTIFACT_RETENTION_OPTIONS = [3, 7, 30] as const;
export type ArtifactRetentionDays = (typeof ARTIFACT_RETENTION_OPTIONS)[number];

/** 每项目规则数上限（P21-7 §3.2）。达到即 [+ 新建规则] 置灰。 */
export const AUTOMATION_RULE_LIMIT = 20;

/** 资源不足时的排队重试上限（03 §8.2 第 3 行：24min × 5）。历史上显示「已排队 n/5」。 */
export const AUTOMATION_MAX_RETRIES = 5;

/** 连续失败 ≥ 此值 → 降频（03 §8.4）。 */
export const DEGRADE_AFTER_FAILURES = 3;
/** 降频后再失败 7 次（即累计 ≥10）→ 自动禁用（03 §8.4）。 */
export const AUTO_DISABLE_AFTER_FAILURES = 10;

// ===== wire 形状（纯类型；运行时校验在 `types/automation.schema.ts`）=====
//
// ⚠️ 这里是**手写接口**而不是 `z.infer<...>`：`z.infer` 需要在编译期看见 schema 值，
//   那会把 zod 重新拖进每一个 import 了本文件的模块（包括 view）。
//   两边的一致性由 `types/__tests__/automationSchemaShape.test.ts` 从外部钉住
//   —— 它拿一份完整对象同时喂给 schema 与类型，任一边少一个字段都编译不过 / 解析不过。

export interface AutomationScheduleConfig {
  /** `hourly`：每小时的第几分钟（0..59）。 */
  minute?: number;
  /** `daily` / `weekly`：本地墙钟 `HH:MM`。 */
  time?: string;
  /** `weekly`：星期，**0=周日 … 6=周六**（JS `Date#getDay` 口径，与后端约定同源）。 */
  days?: number[];
}

export type AutomationDto = components['schemas']['AutomationResponseDto'];

export type AutomationRunDto = components['schemas']['AutomationRunResponseDto'];

/** 分页信封（10 §7.2：**只有 automation runs 用它**，其余列表端点返回裸数组）。 */
export interface AutomationRunPage {
  items: AutomationRunDto[];
  /** 还有更老的一页。⛔ 不回 total —— append-only 流的总数每刻都在变。 */
  hasMore: boolean;
}

/** 运行历史每页条数（P21-7 §3.3）。 */
export const RUNS_PAGE_SIZE = 20;
/** 详情视图默认只显示最近 N 条，其余由 [查看全部] 展开（P21-7 §3.3）。 */
export const RUNS_PREVIEW_COUNT = 10;

/** `POST /api/projects/:id/automations` 请求体（10 §7.3）。 */
export interface CreateAutomationRequest {
  name: string;
  description?: string;
  runtime: string;
  prompt: string;
  scheduleKind: ScheduleKind;
  scheduleConfig: AutomationScheduleConfig;
  /** ★ **创建请求必带**——这是快照发生的那一刻（23 I-AUT-9）。 */
  timezone: string;
  timeoutMinutes: number;
  artifactRetentionDays: number;
  webhookUrl?: string;
  triggerOn?: TriggerOn;
}

/**
 * `PUT /api/automations/:id` 请求体。
 *
 * ★ **`timezone` 在这里是 optional，而且默认就不该出现**：只有用户在表单里显式改了时区，
 * 这个键才允许进 payload（03 §8.1 / 27 §8 前端纪律 0 / 23 I-AUT-9）。理由不是洁癖——
 * 编辑请求体如果顺手把"当前浏览器时区"又传一遍，用户换台机器改个 prompt，
 * 凌晨 3 点的任务就被挪到中午 3 点，而界面上没有任何地方提示发生过这件事。
 */
export type UpdateAutomationRequest = Omit<CreateAutomationRequest, 'timezone'> & {
  timezone?: string;
};

// ===== 视图模型（`lib/automation/*` 产出，view 直接渲染）=====
// ⚠️ 放 types/ 而不是 lib/ 是分层硬要求：view 被 boundaries 禁止 import `lib/`。
//    与 `types/retainedVolume.ts` 的 `RetainedVolumeRow` 同一处理。

/**
 * 规则的四个生命周期态（P21-7 §4 状态机）。
 *
 * ⚠️ **`archivedOff`（随项目归档禁用）刻意不在这个联合里。** 状态机图里有它，
 * 但 F21-7 §10.3 C 已经写明：项目归档功能**F21-6 §10 D 裁决不做**，
 * ⇒「归档 → 规则自动禁用」这条联动这一期无从落地，也不该写进验收。
 * 造一个永远取不到的取值，等于在类型里承诺一件不存在的事（uiSlice 文件头那两个死值同一教训）。
 */
export type AutomationLifecycle = 'on' | 'off' | 'degraded' | 'autoDisabled';

export interface AutomationRow {
  id: string;
  name: string;
  lifecycle: AutomationLifecycle;
  /** ✅ / ⏸️ / 🟡 / 🔴 */
  icon: string;
  statusText: string;
  /** `Codex · 每天 08:00` —— runtime + 人话调度。 */
  summaryText: string;
  /**
   * `下次: 8-10 08:00`。**按规则自带的 `timezone` 快照格式化**，不读浏览器时区。
   * 规则未启用（或后端没给 `nextTriggerAt`）时缺席。
   */
  nextTriggerText?: string;
  /**
   * 规则用的 IANA 时区，**永远显示**（P21-7 §3.2 / F21-7 §6）。
   * 少了它，用户换台机器打开会以为触发时刻漂了——而漂的其实是他自己的系统时区。
   */
  timezone: string;
  /** 时区与本机不一致时的提醒；一致时缺席（一致还提醒是噪音）。 */
  timezoneNote?: string;
  /** 🔴 / 🟡 时展示 [查看原因]。 */
  needsAttention: boolean;
  consecutiveFailures: number;
}

/** 运行结果在界面上的归类。**8 个 status 先收敛成这 6 类**，用户先分清类，再看细节。 */
export type RunOutcomeCategory =
  'success' | 'failure' | 'skipped' | 'missed' | 'waiting' | 'running';

export interface RunOutcome {
  category: RunOutcomeCategory;
  icon: string;
  /** 短标签：`成功` / `失败` / `跳过` / `错过` / `排队重试中` / `运行中`。 */
  label: string;
  /** 一句人话，说清"为什么"。`missed` 这条最重要——它最容易被读成失败。 */
  detail: string;
  /**
   * ★ **是否计入连续失败**（P21-7 §4 计数口径）。
   * 这是界面上区分「真失败了」与「这次没跑」的**唯一硬判据**，不是配色偏好。
   */
  countsTowardFailure: boolean;
}

export interface RunRow {
  id: string;
  outcome: RunOutcome;
  /** 触发时刻，按**规则的时区快照**格式化。 */
  startedAtText: string;
  /** `1 分 12 秒`；未结束或后端没给时缺席。 */
  durationText?: string;
  outputSummary?: string;
  /** 有 sandboxId 才渲染 [打开 Task]（契约暂缺时不渲染死按钮）。 */
  sandboxId?: string;
  /** webhook 投递结果的旁注。⚠️ 它**不影响规则状态**（P21-7 §7），文案上要说清。 */
  webhookNote?: string;
}
