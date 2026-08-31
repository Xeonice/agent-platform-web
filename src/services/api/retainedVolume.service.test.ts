// @vitest-environment node
// 保留卷 service：路径拼接、zod 形状守卫、以及**下载不许 fetch**（10 §6 打包口径）。
import { describe, it, expect, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import {
  deleteRetainedVolume,
  listRetainedVolumes,
  retainedVolumeArchiveUrl,
} from '@/services/api/retainedVolume.service';
import { ApiErrorException } from '@/services/api/apiError';

const BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listRetainedVolumes', () => {
  it('GET /api/retained-volumes?projectId= 命中 msw 并解析出 DTO', async () => {
    const volumes = await listRetainedVolumes('proj-demo');
    expect(volumes.length).toBeGreaterThan(0);
    expect(volumes[0]?.projectId).toBe('proj-demo');
    // 两个大小都必须在 DTO 里（10 §7.3）。
    expect(typeof volumes[0]?.diskBytes).toBe('number');
    expect(typeof volumes[0]?.downloadBytes).toBe('number');
  });

  it('⭐ projectId 真的进了 query（不是被丢掉后拿回全量）', async () => {
    let seen: string | null = 'NOT-CALLED';
    server.use(
      http.get(`${BASE}/api/retained-volumes`, ({ request }) => {
        seen = new URL(request.url).searchParams.get('projectId');
        return HttpResponse.json([]);
      }),
    );
    await listRetainedVolumes('proj-B');
    expect(seen).toBe('proj-B');
  });

  it('projectId 含特殊字符时被正确编码（不拼出一条坏 URL）', async () => {
    let seen: string | null = null;
    server.use(
      http.get(`${BASE}/api/retained-volumes`, ({ request }) => {
        seen = new URL(request.url).searchParams.get('projectId');
        return HttpResponse.json([]);
      }),
    );
    await listRetainedVolumes('a b&c=d');
    expect(seen).toBe('a b&c=d');
  });

  it('⭐ 后端少给一个字段（契约漂移）→ 抛错，而不是渲染出「下载 NaN B」', async () => {
    server.use(
      http.get(`${BASE}/api/retained-volumes`, () =>
        HttpResponse.json([
          {
            id: 'rv-x',
            projectId: 'proj-A',
            source: 'manual-destroy',
            retainedAt: '2026-08-25T10:12:00.000Z',
            retainUntil: '2026-09-24T10:12:00.000Z',
            diskBytes: 1024,
            // downloadBytes 缺席 —— 这三个端点今天没有生成物做编译期兜底，
            // zod 是唯一的保险。
          },
        ]),
      ),
    );
    await expect(listRetainedVolumes('proj-A')).rejects.toBeInstanceOf(ApiErrorException);
  });

  it('⭐ source 是后端没有的取值 → 同样拒收（枚举不是自由字符串）', async () => {
    server.use(
      http.get(`${BASE}/api/retained-volumes`, () =>
        HttpResponse.json([
          {
            id: 'rv-x',
            projectId: 'proj-A',
            source: 'whatever',
            retainedAt: '2026-08-25T10:12:00.000Z',
            retainUntil: '2026-09-24T10:12:00.000Z',
            diskBytes: 1024,
            downloadBytes: 12,
          },
        ]),
      ),
    );
    await expect(listRetainedVolumes('proj-A')).rejects.toBeInstanceOf(ApiErrorException);
  });

  it('非 2xx → 抛 ApiErrorException 并带上后端信封', async () => {
    server.use(
      http.get(`${BASE}/api/retained-volumes`, () =>
        HttpResponse.json(
          { code: 'FORBIDDEN', message: '没有权限', retryable: false },
          { status: 403 },
        ),
      ),
    );
    await expect(listRetainedVolumes('proj-A')).rejects.toMatchObject({
      httpStatus: 403,
      envelope: { code: 'FORBIDDEN' },
    });
  });

  it('非 2xx 且响应体不是 JSON → 兜成 UNKNOWN 信封（不因为解析失败再炸一次）', async () => {
    server.use(
      http.get(`${BASE}/api/retained-volumes`, () =>
        HttpResponse.text('<html>502</html>', { status: 502 }),
      ),
    );
    await expect(listRetainedVolumes('proj-A')).rejects.toMatchObject({
      httpStatus: 502,
      envelope: { code: 'UNKNOWN' },
    });
  });
});

/**
 * ⭐ 这一组是**变异测试补上的**：把 `credentials: 'include'` 改成 `'omit'` 时，
 * 上面所有用例全绿 —— 而启用 `ACCESS_PASSCODE`（11 §3.1，HttpOnly `ap_session`）之后，
 * 这三个端点会**全部 401**，本地开发（无口令）却一点问题都看不出来。
 * 这正是"断言存在 ≠ 断言有效"：凭据策略从来没被任何一条断言碰到过。
 *
 * ⚠️ 下载那条不在这里：它是 `<a href download>` 的**浏览器原生导航**，cookie 由浏览器
 * 自己带（同源），前端连请求都不发 —— 见 `retainedVolumeArchiveUrl` 的注释。
 */
describe('凭据策略（口令门）', () => {
  it('列表请求带 credentials: include', async () => {
    let credentials: RequestCredentials | undefined;
    server.use(
      http.get(`${BASE}/api/retained-volumes`, ({ request }) => {
        credentials = request.credentials;
        return HttpResponse.json([]);
      }),
    );
    await listRetainedVolumes('proj-A');
    expect(credentials).toBe('include');
  });

  it('删除请求带 credentials: include', async () => {
    let credentials: RequestCredentials | undefined;
    server.use(
      http.delete(`${BASE}/api/retained-volumes/:id`, ({ request }) => {
        credentials = request.credentials;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await deleteRetainedVolume('rv-1');
    expect(credentials).toBe('include');
  });
});

describe('deleteRetainedVolume', () => {
  it('DELETE /api/retained-volumes/:id，204 正常返回', async () => {
    let method: string | undefined;
    let path: string | undefined;
    server.use(
      http.delete(`${BASE}/api/retained-volumes/:id`, ({ request }) => {
        method = request.method;
        path = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(deleteRetainedVolume('rv-1')).resolves.toBeUndefined();
    expect(method).toBe('DELETE');
    expect(path).toBe('/api/retained-volumes/rv-1');
  });

  it('404（已被 VolumeReaper 清掉）→ 抛出可识别错误，交给 hook 翻成人话', async () => {
    server.use(
      http.delete(
        `${BASE}/api/retained-volumes/:id`,
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    await expect(deleteRetainedVolume('rv-gone')).rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe('retainedVolumeArchiveUrl', () => {
  it('拼出 /:id/archive', () => {
    expect(retainedVolumeArchiveUrl('rv-1')).toBe(`${BASE}/api/retained-volumes/rv-1/archive`);
  });

  it('id 被编码（斜杠不许把路径拆开）', () => {
    expect(retainedVolumeArchiveUrl('a/b')).toBe(`${BASE}/api/retained-volumes/a%2Fb/archive`);
  });

  /**
   * ⭐ **本轮最重要的一条否定性断言**（10 §6）：下载必须交给浏览器原生下载栏，
   * 后端为此专门给 tar + 精确 `Content-Length`。任何 `fetch` 进来再造 blob 的实现
   * 都会丢掉进度条与「另存为」，还把可能上 GB 的包整个读进内存。
   * ⇒ 求地址这件事**一个网络请求都不许发**。
   */
  it('⭐ 只算地址，不发任何请求（fetch 零调用）', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    retainedVolumeArchiveUrl('rv-1');
    expect(spy).not.toHaveBeenCalled();
  });
});
