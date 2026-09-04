// 自动化 wire 形状的 **运行时** 校验（zod）。
//
// ★ **为什么单独一个文件，而不是像 `types/retainedVolume.ts` 那样和类型放一起**：
//   view 需要本域的几个**值**（`SCHEDULE_KINDS` / `TRIGGER_ON_OPTIONS` /
//   `ARTIFACT_RETENTION_OPTIONS` / `AUTOMATION_RULE_LIMIT` …）来渲染选项，
//   而 `import` 一个值就会把它所在模块**整体**拉进 bundle —— schema 与 zod 一起。
//   保留卷那份没暴露这个问题，是因为 view 只 `import type` 它（类型在编译期被抹掉）。
//   实测代价：storybook 的 vite 在跑到一半时才发现 zod 这个新依赖并重新优化 + reload，
//   整轮测试被打断（"Vite unexpectedly reloaded a test"）；生产 bundle 里同样会多出整个 zod。
//   ⇒ `types/automation.ts` 保持**零运行时依赖**，zod 只活在这里，只被 service 引用。
//
// ⚠️ 与生成类型的关系见 `types/automation.ts` 文件头：后端重导 openapi 之后，
//   这里的每个 schema 后面挂 `satisfies z.ZodType<AutomationDto>` 把两者锁死。
import { z } from 'zod';
import type {
  AutomationDto,
  AutomationRunDto,
  AutomationRunPage,
  AutomationScheduleConfig,
} from '@/types/automation';
import {
  AUTOMATION_RUN_STATUSES,
  AUTOMATION_SKIP_REASONS,
  SCHEDULE_KINDS,
  TRIGGER_ON_OPTIONS,
  WEBHOOK_STATUSES,
} from '@/types/automation';

/**
 * ⭐ **`.datetime()` 不是洁癖，它是在消费一条刚变强的契约。**
 *
 * 后端契约里这些字段已从裸 `z.string()` 收成 `IsoInstantSchema`
 * （openapi 上是 `"format": "date-time"`）——平台只发 `toISOString()` 的 UTC 瞬时。
 * ⚠️ 生成类型救不了这一层：`format` 在 `openapi.d.ts` 里只落成一行注释，`createdAt`
 * 仍然是 `string`，`'not-a-date'` 编译期照样过。⇒ 契约的这一半只有写在这里才有人执行。
 */
const isoInstant = z.string().datetime();

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'time 必须是 HH:MM');

export const AutomationScheduleConfigSchema = z.object({
  /** `hourly`：每小时的第几分钟（0..59）。 */
  minute: z.number().int().min(0).max(59).optional(),
  /** `daily` / `weekly`：本地墙钟 `HH:MM`。 */
  time: timeSchema.optional(),
  /** `weekly`：星期，**0=周日 … 6=周六**（JS `Date#getDay` 口径，与后端约定同源）。 */
  days: z.array(z.number().int().min(0).max(6)).optional(),
});

export const AutomationDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  runtime: z.string(),
  prompt: z.string(),
  scheduleKind: z.enum(SCHEDULE_KINDS),
  scheduleConfig: AutomationScheduleConfigSchema,
  /**
   * IANA 时区，**规则创建时快照**（23 I-AUT-9 / 03 §8.1）。
   * ⛔ 编辑其它字段时不隐式重传（见 `lib/automation/automationPayload`）。
   */
  timezone: z.string(),
  timeoutMinutes: z.number(),
  artifactRetentionDays: z.number(),
  /** 后端出站保证是绝对 http/https URL（`WebhookTarget` 在域里把关，openapi `format: uri`）。 */
  webhookUrl: z.string().url().optional(),
  triggerOn: z.enum(TRIGGER_ON_OPTIONS),
  enabled: z.boolean(),
  /** 连续失败 ≥3 后的「每日重试一次」态（03 §8.4）。 */
  degraded: z.boolean(),
  consecutiveFailures: z.number(),
  /** 上一次触发的时刻；从未触发过时缺席。 */
  lastTriggeredAt: isoInstant.optional(),
  /** UTC ISO；规则从未算过下一次（刚禁用/刚建）时缺席。 */
  nextTriggerAt: isoInstant.optional(),
  createdAt: isoInstant,
  updatedAt: isoInstant,
});

export const AutomationListSchema = z.array(AutomationDtoSchema);

export const AutomationRunDtoSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  status: z.enum(AUTOMATION_RUN_STATUSES),
  /** `resource-exhausted` 时的「已排队 n/5」里的 n。重试**不产生新 run 行**（03 §8.2）。 */
  retryCount: z.number(),
  retryAt: isoInstant.optional(),
  /** 必有 —— 运行历史显示的就是它（skipped/missed 也有）。 */
  triggeredAt: isoInstant,
  /** ⚠️ skipped / missed / pending 缺席。 */
  startedAt: isoInstant.optional(),
  durationMs: z.number().optional(),
  outputSummary: z.string().optional(),
  webhookStatus: z.enum(WEBHOOK_STATUSES).optional(),
  /**
   * ⭐ **三个取值，不是两个。** 上一版手抄成 `['PREVIOUS_RUNNING','AUTH_EXPIRED']`，
   * 漏了 `RESOURCE_EXHAUSTED`（决策表行 3 重试 5 次仍拿不到资源的终态，03 §8.2）。
   * ⚠️ zod 的 `.optional()` 放过**缺席**、放不过**多一个合法取值** ⇒ 那种 run 一出现，
   * `parseOrThrow` 直接抛，**整页运行历史变成一句错误消息、0 行**，连同页里另外
   * 19 条正常记录一起消失。一次本该降级显示的事故被升级成了整页不可用。
   */
  errorCode: z.enum(AUTOMATION_SKIP_REASONS).optional(),
  /** `failed` 行唯一能说清「为什么挂了」的字段。 */
  errorMessage: z.string().optional(),
  completedAt: isoInstant.optional(),
  sandboxId: z.string().optional(),
});

/**
 * `POST /api/automations/webhook-test` 的响应。
 *
 * ⚠️ **它总是 HTTP 200**，成败在 `ok` 里（后端 controller 的 `@HttpCode(200)`：
 * 投递失败是目标端的事，不该让 HTTP 层去解释）。⛔ 调用方只看 status 会把
 * SSRF 拒绝 / 连不上 / 超时全渲染成「已送达」。
 */
export const WebhookTestResultSchema = z.object({
  ok: z.boolean(),
  errorCode: z
    .enum(['VALIDATION_FAILED', 'HOST_NOT_ALLOWED', 'TIMEOUT', 'UPSTREAM_UNAVAILABLE'])
    .optional(),
  message: z.string(),
});

/** 分页信封（10 §7.2：**只有 automation runs 用它**，其余列表端点返回裸数组）。 */
export const AutomationRunPageSchema = z.object({
  items: z.array(AutomationRunDtoSchema),
  hasMore: z.boolean(),
});

// ★ 手写类型（`types/automation.ts`）与运行时 schema 的**双向**锁：
//   · `satisfies z.ZodType<T>` —— schema 解析出来的东西必须能当 T 用（schema 少字段 ⇒ 编译红）；
//   · 下面的 `Assert*` —— T 必须能被 schema 接住（类型多字段而 schema 没有 ⇒ 编译红）。
//   两个方向都要，只挂一边的话另一边可以悄悄漂。
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertScheduleConfig = Exact<
  z.infer<typeof AutomationScheduleConfigSchema>,
  AutomationScheduleConfig
>;
type AssertAutomation = Exact<z.infer<typeof AutomationDtoSchema>, AutomationDto>;
type AssertRun = Exact<z.infer<typeof AutomationRunDtoSchema>, AutomationRunDto>;
type AssertPage = Exact<z.infer<typeof AutomationRunPageSchema>, AutomationRunPage>;

/* eslint-disable @typescript-eslint/no-unused-vars -- 编译期断言，只为让漂移在 tsc 就红 */
const _assertScheduleConfig: AssertScheduleConfig = true;
const _assertAutomation: AssertAutomation = true;
const _assertRun: AssertRun = true;
const _assertPage: AssertPage = true;
/* eslint-enable @typescript-eslint/no-unused-vars */
