// 系统状态页的 REST（F21-5 §4 / 10 §6.6.1 / 27 §295-296）。本轮只落**审计流**两个端点——
// `/api/system/resources`、`/api/system/providers`、`/api/system/diagnose` 后端尚未落地，
// 生成的 `openapi.d.ts` 里没有它们，写在这里只会是手抄的假类型（14 明令禁止）。
//
// ⚠️ **本文件两条纪律都在"发不发请求"上，不在"怎么发"上**：
//
//  ① `since` / `before` **互斥由前端当场挡**（28 §9）。让后端回 400 也对，但那是一次
//     可以在前端消灭的往返，而且错误会发生在**离成因最远的地方**——网络面板里一条 400，
//     成因却是十几帧之前某个 hook 同时算出了两个游标。这里抛，栈直接指着调用点。
//  ② `exportAudit()` **不解析 body，也不 fetch**（F21-5 §4）。包是 tar.gz，几十 MB，
//     前端读它没有任何用途；用一次浏览器导航把 `Content-Disposition` 交给浏览器，
//     内存里不留副本。⚠️ 一旦有人"顺手"改成 `fetch` + `blob()`，界面完全正常，
//     只是 50MB 包会整个进 JS 堆——`system.service.test.ts` 有一条断言守着它。
//     ⚠️ 而这次导航**必须去新标签页**（`target="_blank"`）：成功时响应带
//     `Content-Disposition: attachment`，浏览器下载、开的那个标签页当场自己关掉，用户无感；
//     **失败时后端刻意保留了 JSON 错误信封**（`application/json`，没有那个头），
//     同标签页导航会把整个 SPA 换成一张裸 JSON 错误页——筛选、滚动位置、展开的行全没了，
//     而"导出失败"本身只是一次可重试的小事。污染一个新标签页远好过弄丢应用。
import { apiClient, API_BASE_URL } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import { toAuditWireQuery, AUDIT_PAGE_LIMIT, type AuditCursor } from '@/lib/audit/auditStream';
import type { AuditFilters, AuditListDto } from '@/types/audit';

export class AuditCursorConflictError extends Error {
  constructor() {
    super(
      'since 与 before 互斥：since 向新翻页（增量刷新）、before 向老翻页（历史滚动），一次只能给一个方向',
    );
    this.name = 'AuditCursorConflictError';
  }
}

export interface ListAuditQuery extends AuditFilters, AuditCursor {
  limit?: number;
}

/**
 * `GET /api/system/audit` —— 双向游标（10 §6.6.1）。响应恒按 `seq` 降序 + `hasMore`。
 *
 * `hasMore` 在两个方向含义不同：`since` 方向 = 「还有更新的没拉完」= **有断层**；
 * `before` 方向 = 「还有更老的」= 可继续滚。调用方据此分岔，本层不解释。
 */
export async function listAudit(query: ListAuditQuery): Promise<AuditListDto> {
  if (query.since !== undefined && query.before !== undefined) {
    throw new AuditCursorConflictError();
  }
  const wire = toAuditWireQuery(
    query,
    {
      ...(query.since === undefined ? {} : { since: query.since }),
      ...(query.before === undefined ? {} : { before: query.before }),
    },
    query.limit ?? AUDIT_PAGE_LIMIT,
  );
  const { data, error, response } = await apiClient.GET('/api/system/audit', {
    params: { query: wire },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/**
 * `GET /api/system/audit/export` —— 触发浏览器下载 tar.gz（`audit.jsonl` + `runtime.log` +
 * `diagnose.json` + `export-range.json`）。**前端不解析 body、也不自己标注截取范围**
 * ——范围由后端写进包里的 `export-range.json`（P21-5 §10.3）。
 *
 * 同源导航天然带上 HttpOnly 的 `ap_session` cookie（口令门 11 §3.1），无需 `credentials` 配置。
 */
export function exportAudit(): void {
  const anchor = document.createElement('a');
  anchor.href = `${API_BASE_URL}/api/system/audit/export`;
  // download 属性刻意不给文件名：文件名在后端的 Content-Disposition 里（带导出时刻），
  // 前端编一个会盖掉它。
  // ⛔ `target` 不许去掉：见文件头 ②（失败时的 JSON 信封会把当前页整个导航掉）。
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
