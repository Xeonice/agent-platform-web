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
  webhookUrl: z.string().optional(),
  triggerOn: z.enum(TRIGGER_ON_OPTIONS).optional(),
  enabled: z.boolean(),
  /** 连续失败 ≥3 后的「每日重试一次」态（03 §8.4）。 */
  degraded: z.boolean(),
  consecutiveFailures: z.number(),
  /** UTC ISO；规则从未算过下一次（刚禁用/刚建）时缺席。 */
  nextTriggerAt: z.string().optional(),
});

export const AutomationListSchema = z.array(AutomationDtoSchema);

export const AutomationRunDtoSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  status: z.enum(AUTOMATION_RUN_STATUSES),
  /** `resource-exhausted` 时的「已排队 n/5」里的 n。重试**不产生新 run 行**（03 §8.2）。 */
  retryCount: z.number(),
  retryAt: z.string().optional(),
  /** 必有 —— 运行历史显示的就是它（skipped/missed 也有）。 */
  triggeredAt: z.string(),
  /** ⚠️ skipped / missed / pending 缺席。 */
  startedAt: z.string().optional(),
  durationMs: z.number().optional(),
  outputSummary: z.string().optional(),
  webhookStatus: z.enum(WEBHOOK_STATUSES).optional(),
  /** ⏳ 契约暂缺（见文件头）。缺席时两种 skipped 只能显示同一句话。 */
  errorCode: z.enum(AUTOMATION_SKIP_REASONS).optional(),
  /** ⏳ 契约暂缺（见文件头）。缺席时 [打开 Task] 不渲染，而不是渲染一个点了没反应的按钮。 */
  sandboxId: z.string().optional(),
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
