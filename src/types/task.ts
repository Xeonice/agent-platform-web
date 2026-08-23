// 无头 Task（S6）的类型消费点。**wire 形状一律来自生成物**（28 §1：前端不手写 DTO）——
// 后端改 zod → `openapi:emit` → `generate:api`，这里以及下游 service/hook/view 在 tsc 阶段逐点报红。
//
// 运行时校验只留在 WS 那一侧（`ws-protocol.ts`）：REST 有 openapi 契约做编译期保证，
// 而 WS 是没有 openapi 的通道，必须自带 zod（16 §3）。
import type { components, paths } from '@/types/generated/openapi';

/** 任务 DTO（POST 202 / GET 单条 / GET 列表 / cancel 202 四处响应同形）。 */
export type AgentTaskDto = components['schemas']['AgentTaskResponseDto'];

/** 任务状态：`running` 之外全是终态。 */
export type TaskStatus = AgentTaskDto['status'];

/** 产物列表项。 */
export type TaskArtifact = AgentTaskDto['artifacts'][number];

/**
 * 任务终态错误码。
 *
 * ⏳ **今天它还是开放的 `string`**：后端正在把这组码收成 zod enum 再进 openapi。
 * 收窄那天 `lib/taskOutcome.ts` 的词表要改成 `satisfies Record<TaskErrorCode, string>` 咬死
 * （后端加码而前端没跟上 ⇒ tsc 阶段红）。`taskOutcome.test.ts` 里有个哨兵用例盯着这件事：
 * 一旦这里不再是 `string`，那个用例会在编译期失败，提醒把 satisfies 加上。
 */
export type TaskErrorCode = NonNullable<AgentTaskDto['errorCode']>;

/** POST 请求体（`RunAgentTaskDto`）。 */
export type RunAgentTaskInput =
  paths['/api/sandboxes/{id}/runtimes/{rt}/tasks']['post']['requestBody']['content']['application/json'];

/** 透传给 CLI 的额外旗标白名单（生成物里就是字面量联合，前端不再自己列一份）。 */
export type TaskExtraArg = NonNullable<RunAgentTaskInput['extraArgs']>[number];

/**
 * 白名单的**运行时**副本（view 要拿它渲染勾选项的标签）。
 * `satisfies` 咬合生成的字面量联合：后端收窄白名单 ⇒ 这里当场报红。
 */
export const TASK_EXTRA_ARGS = ['--verbose'] as const satisfies readonly TaskExtraArg[];

/** 白名单上限（`maxItems`，openapi 的数组约束落不进 TS 类型，只能在此备注）。 */
export const TASK_EXTRA_ARGS_MAX = 4;

/**
 * 硬超时档位（分钟）。
 *
 * ⚠️ **这是唯一一处没能咬合生成类型的地方**：后端 zod 是 `oneOf(30|60|120|240)`，
 * 而 openapi-typescript 把带 min/max 的 `oneOf` 拍平成了 `number` ⇒ 闭集在生成物里丢了。
 * 因此档位表只能前端自留一份。**代价要说清楚**：后端将来加一档（比如 480），
 * 这里不会有任何编译错误，UI 只是静默地不提供那一档。
 */
export const TASK_TIMEOUT_OPTIONS = [30, 60, 120, 240] as const;
export type TaskTimeoutMinutes = (typeof TASK_TIMEOUT_OPTIONS)[number];

/**
 * 任务指令长度：**1..8000 码点**（openapi 的 minLength/maxLength 同样落不进 TS 类型）。
 * 放 types/ 是为了 view（不能 import lib）与 container 共用同一个常量。
 */
export const TASK_PROMPT_MAX_LENGTH = 8000;
export const TASK_PROMPT_MIN_LENGTH = 1;

/** 终态判定（`running` 之外全是终态）。 */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status !== 'running';
}
