// `services/api/system.service.ts` 单测（F21-5 §7.1 ⑥⑦）。MSW node server 由 vitest.setup.ts 全局 listen。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { AuditCursorConflictError, exportAudit, listAudit } from '@/services/api/system.service';
import { ApiErrorException } from '@/services/api/apiError';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

/** 记录每一次落到 `/api/system/audit` 的 query（断言"发了什么"而不是"回了什么"）。 */
function captureQueries(): URLSearchParams[] {
  const seen: URLSearchParams[] = [];
  server.use(
    http.get(`${API_BASE}/api/system/audit`, ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json({ items: [], hasMore: false });
    }),
  );
  return seen;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listAudit —— since / before 互斥由前端当场挡', () => {
  it('同时传两个 ⇒ 抛错，且**一个请求都不发**（不是等后端回 400）', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(listAudit({ since: 10, before: 90 })).rejects.toBeInstanceOf(
      AuditCursorConflictError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('单方向照常发（两条都验一遍，免得"互斥"退化成"两个都不许传"）', async () => {
    const seen = captureQueries();
    await listAudit({ since: 10 });
    await listAudit({ before: 90 });
    expect(seen[0]?.get('since')).toBe('10');
    expect(seen[0]?.get('before')).toBeNull();
    expect(seen[1]?.get('before')).toBe('90');
    expect(seen[1]?.get('since')).toBeNull();
  });
});

describe('listAudit —— 上 wire 的参数', () => {
  it('「仅告警」**上 wire 且是并集**：`severity=warn,error`（单值会丢掉另一半）', async () => {
    const seen = captureQueries();
    await listAudit({ severity: 'warn-and-error' });
    // ⚠️ 按集合断言而不是按字符串：真正错法是"只发 warn"或"只发 error"，
    // 那样界面上只是少一半告警，而空态与翻页入口依然看着正常。
    expect(seen[0]?.get('severity')?.split(',').sort()).toEqual(['error', 'warn']);
  });

  it('没开「仅告警」⇒ 一个 severity 键都不发（不是 `?severity=`）', async () => {
    const seen = captureQueries();
    await listAudit({});
    expect(seen[0]?.has('severity')).toBe(false);
  });

  it('类别 / subjectId / 时间范围照常上 wire，limit 默认 200', async () => {
    const seen = captureQueries();
    await listAudit({
      category: 'sandbox',
      subjectId: 'sb-1',
      from: '2026-08-26T00:00:00.000Z',
      to: '2026-08-27T00:00:00.000Z',
    });
    expect(seen[0]?.get('category')).toBe('sandbox');
    expect(seen[0]?.get('subjectId')).toBe('sb-1');
    expect(seen[0]?.get('from')).toBe('2026-08-26T00:00:00.000Z');
    expect(seen[0]?.get('to')).toBe('2026-08-27T00:00:00.000Z');
    expect(seen[0]?.get('limit')).toBe('200');
  });

  it('非 2xx ⇒ 抛 ApiErrorException（信封原样带出，供 UI 分岔）', async () => {
    server.use(
      http.get(`${API_BASE}/api/system/audit`, () =>
        HttpResponse.json(
          { code: 'VALIDATION_FAILED', message: 'limit 超上限', retryable: false },
          { status: 400 },
        ),
      ),
    );
    await expect(listAudit({ limit: 501 })).rejects.toBeInstanceOf(ApiErrorException);
  });

  it('响应原样返回（items + hasMore，前端不在 service 层重排）', async () => {
    server.use(
      http.get(`${API_BASE}/api/system/audit`, () =>
        HttpResponse.json({
          items: [
            {
              seq: 9,
              at: '2026-08-26T10:00:00.123Z',
              category: 'system',
              type: 'system.x',
              severity: 'info',
              actor: 'system',
              summary: 'x',
            },
          ],
          hasMore: true,
        }),
      ),
    );
    const page = await listAudit({});
    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(1);
  });
});

describe('exportAudit —— 不 fetch、不解析 body', () => {
  it('只触发一次浏览器导航；**没有任何 fetch**（改成 fetch+blob() 会把 50MB 包读进 JS 堆）', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    exportAudit();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('指向导出端点，且**不自己编文件名**（文件名在后端 Content-Disposition 里）', () => {
    let href = '';
    let download: string | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      href = this.href;
      download = this.getAttribute('download');
    });

    exportAudit();

    expect(href).toContain('/api/system/audit/export');
    expect(download).toBeNull();
  });

  it('⭐ 去**新标签页**（`target="_blank"`）：失败时后端回的是 JSON 信封，同标签页会把整个 SPA 导航掉', () => {
    // ⚠️ 这条是本文件的证伪用例：去掉 `target` 之后，成功路径（下载）表现毫无差别
    //    ——`Content-Disposition: attachment` 让浏览器下载、页面不动——
    //    只有导出失败那一刻，用户的筛选与滚动位置连同整个应用一起变成一张裸 JSON 错误页。
    let target = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      target = this.target;
    });

    exportAudit();

    expect(target).toBe('_blank');
  });

  it('用完把 anchor 从 DOM 摘掉（不在页面里留一串隐形节点）', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    exportAudit();
    expect(document.querySelectorAll('a[href*="audit/export"]')).toHaveLength(0);
  });
});
