// 自动化 REST（10 §6.5 的 7 条 + webhook-test）。
//
// ⚠️ **本文件不走 typed `apiClient`，与 `retainedVolume.service.ts` 上一轮同一处境**：
// `openapi.json` 里还没有 `/api/projects/:id/automations` 与 `/api/automations/*`
// （后端并行实现中），`createClient<paths>` 连路径字面量都不接受。
// services/ 是全站唯一允许 `fetch` 的层（07 §3 规则 5），退到裸 fetch 是合法的；
// 代价是丢了编译期形状保护，由 `types/automation.ts` 的 zod schema 在运行时补回来。
// ⏳ 后端重导 openapi 之后：把这些函数改回 `apiClient`，zod 校验保留。
import { API_BASE_URL } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import {
  AutomationDtoSchema,
  AutomationListSchema,
  AutomationRunDtoSchema,
  AutomationRunPageSchema,
} from '@/types/automation.schema';
import { RUNS_PAGE_SIZE } from '@/types/automation';
import type {
  AutomationDto,
  AutomationRunDto,
  AutomationRunPage,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from '@/types/automation';
import type { z } from 'zod';

/**
 * 与 `apiClient` 完全一致的凭据策略：口令门的 HttpOnly `ap_session` 必须带上（11 §3.1）。
 *
 * ⚠️ 上一轮的教训：这一行被改成 `'omit'` 时，14 个用例照常全绿 —— 因为 MSW 不校验凭据，
 * 而"断言存在 ≠ 断言有效"。`automation.service.test.ts` 里现在有一条**直接读
 * `request.credentials`** 的用例把它钉住。
 */
const CREDENTIALS: RequestCredentials = 'include';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function apiOrigin(): string {
  // 空串 = 同源相对路径（见 client.ts 的长注释），此时不要拼 origin。
  return API_BASE_URL;
}

async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  throw new ApiErrorException(
    toApiError(await readErrorBody(response), response.status),
    response.status,
  );
}

/**
 * 形状不对 = 后端契约漂移。**宁可报错也不要半渲染**：少一个 `status` 会让运行历史把
 * 一次 `missed` 渲染成空白行，而空白行会被读成"成功但没输出"——不报错、有内容、内容是错的。
 */
async function parseOrThrow<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new ApiErrorException(toApiError(undefined, response.status), response.status);
  }
  return parsed.data;
}

/** `GET /api/projects/:id/automations` → `AutomationDto[]`（裸数组，10 §7.2）。 */
export async function listAutomations(projectId: string): Promise<AutomationDto[]> {
  const response = await fetch(
    `${apiOrigin()}/api/projects/${encodeURIComponent(projectId)}/automations`,
    { credentials: CREDENTIALS },
  );
  await ensureOk(response);
  return parseOrThrow(response, AutomationListSchema);
}

/** `POST /api/projects/:id/automations`。请求体**必带 `timezone`**（创建即快照，23 I-AUT-9）。 */
export async function createAutomation(
  projectId: string,
  body: CreateAutomationRequest,
): Promise<AutomationDto> {
  const response = await fetch(
    `${apiOrigin()}/api/projects/${encodeURIComponent(projectId)}/automations`,
    {
      method: 'POST',
      credentials: CREDENTIALS,
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
  );
  await ensureOk(response);
  return parseOrThrow(response, AutomationDtoSchema);
}

/**
 * `PUT /api/automations/:id`。
 * ⛔ 调用方必须用 `buildUpdatePayload` 造 body —— 它保证**没显式改过就不带 `timezone`**。
 * 本函数不再做第二道判断（两处判断会各自漂移），只是把 body 原样发出去。
 */
export async function updateAutomation(
  id: string,
  body: UpdateAutomationRequest,
): Promise<AutomationDto> {
  const response = await fetch(`${apiOrigin()}/api/automations/${encodeURIComponent(id)}`, {
    method: 'PUT',
    credentials: CREDENTIALS,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  await ensureOk(response);
  return parseOrThrow(response, AutomationDtoSchema);
}

/** `DELETE /api/automations/:id` → 204。**级联删运行历史**，调用方必须先二次确认。 */
export async function deleteAutomation(id: string): Promise<void> {
  const response = await fetch(`${apiOrigin()}/api/automations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: CREDENTIALS,
  });
  await ensureOk(response);
}

/**
 * `POST /api/automations/:id/enable` · `/disable`。
 * `enable` 同时把 `consecutive_failures` 清零（03 §8.4），所以 [重新启用] 和 [启用] 是同一个端点。
 */
export async function setAutomationEnabled(id: string, enabled: boolean): Promise<AutomationDto> {
  const action = enabled ? 'enable' : 'disable';
  const response = await fetch(
    `${apiOrigin()}/api/automations/${encodeURIComponent(id)}/${action}`,
    { method: 'POST', credentials: CREDENTIALS },
  );
  await ensureOk(response);
  return parseOrThrow(response, AutomationDtoSchema);
}

/** `GET /api/automations/:id/runs?before=&limit=` → `{ items, hasMore }`（游标，与审计流同形）。 */
export async function listAutomationRuns(
  automationId: string,
  before: string | undefined,
): Promise<AutomationRunPage> {
  const url =
    `${apiOrigin()}/api/automations/${encodeURIComponent(automationId)}/runs` +
    `?limit=${String(RUNS_PAGE_SIZE)}` +
    (before === undefined ? '' : `&before=${encodeURIComponent(before)}`);
  const response = await fetch(url, { credentials: CREDENTIALS });
  await ensureOk(response);
  return parseOrThrow(response, AutomationRunPageSchema);
}

/** `GET /api/automations/runs/:runId` → 单条详情（含 `outputSummary`）。 */
export async function getAutomationRun(runId: string): Promise<AutomationRunDto> {
  const response = await fetch(`${apiOrigin()}/api/automations/runs/${encodeURIComponent(runId)}`, {
    credentials: CREDENTIALS,
  });
  await ensureOk(response);
  return parseOrThrow(response, AutomationRunDtoSchema);
}

/**
 * `POST /api/automations/webhook-test { url }`（03 §8.5 表最后一行）。
 * 后端代发一条 `event:'test'` 的样例载荷，同样走 10s 超时与 SSRF 规则。
 *
 * ★ **必须由后端代发，前端不能自己 fetch 那个 URL**：浏览器发出去会带上用户的 cookie/来源，
 *   会被 CORS 拦掉，而且完全绕过了后端那套 SSRF 判定——测试通过了不代表真投递能通。
 */
export async function testWebhook(url: string): Promise<void> {
  const response = await fetch(`${apiOrigin()}/api/automations/webhook-test`, {
    method: 'POST',
    credentials: CREDENTIALS,
    headers: JSON_HEADERS,
    body: JSON.stringify({ url }),
  });
  await ensureOk(response);
}
