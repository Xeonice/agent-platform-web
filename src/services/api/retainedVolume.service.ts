// 保留卷 REST（10 §7.3 / P20 §6 决策 2 / 审计 P2-5 三端点统一前缀）。
//
// ⚠️ **本文件不走 typed `apiClient`，这是被迫的、不是偷懒。** `openapi.json` 里还没有
// `/api/retained-volumes*`（后端并行实现中），`createClient<paths>` 连路径字面量都不接受。
// services/ 是全站唯一允许 `fetch` 的层（07 §3 规则 5），所以退到裸 fetch 是**合法**的；
// 代价是丢了编译期形状保护，由 `types/retainedVolume.ts` 的 zod schema 在运行时补回来。
// ⏳ 后端重导 openapi 之后：把三个函数改回 `apiClient`，zod 校验保留（流式/下载那条更需要它）。
import { API_BASE_URL } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import { RetainedVolumeListSchema } from '@/types/retainedVolume';
import type { RetainedVolumeDto } from '@/types/retainedVolume';

/** 与 `apiClient` 完全一致的凭据策略：口令门的 HttpOnly `ap_session` 必须带上（11 §3.1）。 */
const CREDENTIALS: RequestCredentials = 'include';

async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    // 204 / 空体 / 非 JSON 错误页：交给 toApiError 兜成 UNKNOWN 信封。
    return undefined;
  }
}

/**
 * `GET /api/retained-volumes?projectId=` → `RetainedVolumeDto[]`。
 *
 * ⚠️ **响应里不含已清理的记录**（契约注释：`deletedAt` 非空即只读，GET 不下发）。
 * 因此前端**没有**"过滤已清理"这一步 —— DTO 里连 `deletedAt` 字段都没有，想过滤也无从下手。
 * 这是刻意的分工：23 I-RV-2 的"转只读"是后端不变量，界面上的体现就是它压根不出现。
 */
export async function listRetainedVolumes(projectId: string): Promise<RetainedVolumeDto[]> {
  // 手拼而不是 `new URL()`：`API_BASE_URL` 空串（= 同源）时 `new URL` 需要一个 base，
  // 而唯一能给的 `window.location.origin` 在 node 测试环境里不存在。
  const url = `${apiOrigin()}/api/retained-volumes?projectId=${encodeURIComponent(projectId)}`;
  const response = await fetch(url, { credentials: CREDENTIALS });
  if (!response.ok) {
    throw new ApiErrorException(
      toApiError(await readErrorBody(response), response.status),
      response.status,
    );
  }
  const parsed = RetainedVolumeListSchema.safeParse(await response.json());
  if (!parsed.success) {
    // 形状不对 = 后端契约漂移。**宁可报错也不要半渲染**：少一个 downloadBytes 会在界面上
    // 变成「下载 NaN B」，而那是"不报错、有内容、内容是错的"那一类最坏的失败。
    throw new ApiErrorException(toApiError(undefined, response.status), response.status);
  }
  return parsed.data;
}

/** `DELETE /api/retained-volumes/:id` → 204。**不可逆**，调用方必须先做二次确认。 */
export async function deleteRetainedVolume(id: string): Promise<void> {
  const response = await fetch(`${apiOrigin()}/api/retained-volumes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: CREDENTIALS,
  });
  if (!response.ok) {
    throw new ApiErrorException(
      toApiError(await readErrorBody(response), response.status),
      response.status,
    );
  }
}

/**
 * `GET /api/retained-volumes/:id/archive` 的**地址**，不是它的内容。
 *
 * ⛔ **本函数刻意不 fetch。** 后端给的是 tar + 精确 `Content-Length`（10 §6「保留卷的打包
 * 口径」：不压缩就是为了这个数给得出来），而这个数唯一的用处就是让**浏览器自己**的下载栏
 * 画出真实进度条。把流 `fetch` 进来再造 blob 会同时丢掉两样东西：进度条（blob 在下完之前
 * 不存在）与「另存为」（浏览器的下载管理器根本没参与）；顺带还把一个可能上 GB 的包整个读进
 * 内存。⇒ 调用方拿这个字符串直接喂 `<a href download>`，前端零代码。
 */
export function retainedVolumeArchiveUrl(id: string): string {
  return `${apiOrigin()}/api/retained-volumes/${encodeURIComponent(id)}/archive`;
}

/**
 * 空串 = 同源相对路径（见 `client.ts` 的长注释），此时**不要**拼 origin：
 * `/api/...` 交给浏览器按当前页面解析，正是 Next rewrites 那条路。
 */
function apiOrigin(): string {
  return API_BASE_URL;
}
