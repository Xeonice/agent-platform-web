// e2e 替身的**契约锚点**（29 §3.2）。
//
// ★ 为什么要有这个文件：`e2e/**` 的 171 处 `page.route` 替身此前全是**手写对象字面量**，
//   契约变了它们静默通过 —— 而后端替身 `implements` 端口接口，同一件事在编译期就红
//   （29 §1.3 那张不对等表）。`e2e/**/*.ts` 在 `tsconfig.json` 的 `include` 里，所以给
//   fixture 挂上 `satisfies XxxDto` 是**真锁**：少一个契约必填字段当场 TS1360。
//
// ⚠️ 本文件只放三样东西，⛔ 不放任何"另造的一套类型"：
//   ① 契约里**没有具名 DTO** 的响应形状（内联 schema ⇒ 从 `operations` 派生）；
//   ② 契约里**根本没有 body** 的响应（`/api/health`）；
//   ③ 复用面最广的几条 stub helper。
//   有具名 DTO 的一律从 `../src/types/*` 取（它们已改指 `components['schemas'][...]`）。
import type { Page } from '@playwright/test';
import type { components, operations } from '../src/types/generated/openapi';

/** 全站错误信封（10 §6.8 / §7.5）。与 `services/api/apiError` 的别名同一个源。 */
export type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

/** `GET /api/projects/:id/branches` → `string[]`（契约里是内联 schema，无具名 DTO）。 */
export type BranchListDto =
  operations['ProjectController_listBranches']['responses'][200]['content']['application/json'];

/**
 * `GET /api/health` 的**契约响应没有 body**（`content?: never`），而前端的 `getHealth`
 * 只读 `response.ok` / `status`；openapi-fetch 默认按 JSON 解析 ⇒ 替身仍须给一段合法 JSON。
 *
 * `Record<string, never>` 把"空对象是刻意的"这件事写进类型：谁往里塞一个键，
 * 编译期就会拦住他 —— 因为那意味着他其实想改契约。
 */
export const HEALTH_BODY: Record<string, never> = {};

/** `GET /api/health` 的通用桩（几乎每条用例都要）。 */
export async function stubHealth(page: Page): Promise<void> {
  await page.route('**/api/health*', (route) => route.fulfill({ json: HEALTH_BODY }));
}
