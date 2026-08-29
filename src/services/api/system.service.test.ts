// `services/api/system.service.ts` 单测（F21-5 §7.1 ⑥⑦）。MSW node server 由 vitest.setup.ts 全局 listen。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import {
  AuditCursorConflictError,
  DiagnoseStreamAborted,
  diagnose,
  exportAudit,
  getInitStatus,
  getProviders,
  getResources,
  getSettings,
  init,
  listAudit,
  putSettings,
} from '@/services/api/system.service';
import { ApiErrorException } from '@/services/api/apiError';
import type { SystemResourcesDto, SystemSettingsDto } from '@/types/system';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

const GB = 1024 ** 3;
const SETTINGS: SystemSettingsDto = {
  initialized: true,
  accessPasscodeEnabled: false,
  version: { platform: '1.1.0', node: 'v20.11.0' },
};
const RESOURCES: SystemResourcesDto = {
  cpu: { cores: 8, loadAvg1m: 1, usedPercent: 12.5, level: 'ok' },
  ram: { totalBytes: 16 * GB, usedBytes: 4 * GB, usedPercent: 25, level: 'ok' },
  disk: {
    path: '/data',
    totalBytes: 200 * GB,
    usedBytes: 100 * GB,
    availableBytes: 100 * GB,
    usedPercent: 50,
    level: 'ok',
    reservedPercent: 15,
  },
  retainedVolumes: { count: 0, totalBytes: 0, percentOfDisk: 0, level: 'ok', truncated: false },
  activeTasks: 0,
};

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

// ————————————————————————————————————————————————————————————————
// 其余五个 REST 端点（F21-8 会复用这一层）
// ————————————————————————————————————————————————————————————————

describe('系统状态 / 初始化的五个 REST 端点', () => {
  it('六个端点各自打对路径与方法（走错方法在真后端是 404，替身里却常常"碰巧也通"）', async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${API_BASE}/api/system/init-status`, ({ request }) => {
        seen.push(`GET ${new URL(request.url).pathname}`);
        return HttpResponse.json({ initialized: false });
      }),
      http.post(`${API_BASE}/api/system/init`, ({ request }) => {
        seen.push(`POST ${new URL(request.url).pathname}`);
        return HttpResponse.json({ initialized: true }, { status: 201 });
      }),
      http.get(`${API_BASE}/api/system/settings`, ({ request }) => {
        seen.push(`GET ${new URL(request.url).pathname}`);
        return HttpResponse.json(SETTINGS);
      }),
      http.put(`${API_BASE}/api/system/settings`, ({ request }) => {
        seen.push(`PUT ${new URL(request.url).pathname}`);
        return HttpResponse.json(SETTINGS);
      }),
      http.get(`${API_BASE}/api/system/resources`, ({ request }) => {
        seen.push(`GET ${new URL(request.url).pathname}`);
        return HttpResponse.json(RESOURCES);
      }),
      http.get(`${API_BASE}/api/system/providers`, ({ request }) => {
        seen.push(`GET ${new URL(request.url).pathname}`);
        return HttpResponse.json({
          providers: [],
          runtimes: [],
          imageSpecs: [],
          healthWindowMs: 1,
        });
      }),
    );

    await getInitStatus();
    await init({});
    await getSettings();
    await putSettings({ publicBaseUrl: null });
    await getResources();
    await getProviders();

    expect(seen).toEqual([
      'GET /api/system/init-status',
      'POST /api/system/init',
      'GET /api/system/settings',
      'PUT /api/system/settings',
      'GET /api/system/resources',
      'GET /api/system/providers',
    ]);
  });

  it('`putSettings` 把 `null` 原样上 wire（`null`=清空、缺席=不改，两者不许被折叠）', async () => {
    let bodyKeys: string[] = [];
    let body: unknown;
    server.use(
      http.put(`${API_BASE}/api/system/settings`, async ({ request }) => {
        body = await request.json();
        bodyKeys = Object.keys(body ?? {});
        return HttpResponse.json(SETTINGS);
      }),
    );
    await putSettings({ proxyConfig: null });
    // ⚠️ 反面：`JSON.stringify` 掉 undefined 是对的，掉 null 就把"清空"变成了"不改"
    //    ——用户点了[清除代理]，界面显示已清除，下次刷新它又回来了。
    expect(body).toEqual({ proxyConfig: null });
    // ⚠️ 键的**集合**也要断言：多带一个 `publicBaseUrl: null` 上去，就把"没动它"
    //    变成了"清空它"。
    expect(bodyKeys).toEqual(['proxyConfig']);
  });

  it('`init` 的 409（已初始化）照常抛信封 —— 它是"这件事做过了"，不是要重试的错误', async () => {
    server.use(
      http.post(`${API_BASE}/api/system/init`, () =>
        HttpResponse.json(
          { code: 'ALREADY_INITIALIZED', message: '平台已初始化', retryable: false },
          { status: 409 },
        ),
      ),
    );
    await expect(init({})).rejects.toBeInstanceOf(ApiErrorException);
  });

  it('`getResources` 非 2xx ⇒ 抛 ApiErrorException（⛔ 不许回一个"全 0"的水位）', async () => {
    server.use(
      http.get(`${API_BASE}/api/system/resources`, () =>
        HttpResponse.json(
          { code: 'INTERNAL', message: '读取失败', retryable: true },
          { status: 500 },
        ),
      ),
    );
    // ⚠️ 这条守的是"失败不许伪装成空"在资源卡上的版本：一个 0% 的水位条读起来是
    //    "很空闲"，而真相是这个数字根本没取到。
    await expect(getResources()).rejects.toBeInstanceOf(ApiErrorException);
  });
});

// ————————————————————————————————————————————————————————————————
// SSE 诊断流（F21-5 §7.1 services 五条 + §5A 五条规矩）
// ————————————————————————————————————————————————————————————————

/** 把若干"网络分片"拼成一条流（一个分片 = 一次 `read()` 可能拿到的那一块）。 */
function sseStream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

function frameText(frame: Record<string, unknown>): string {
  return `event: ${String(frame['event'])}\ndata: ${JSON.stringify(frame)}\n\n`;
}

const START = {
  event: 'start',
  checks: [
    { id: 'container-runtime', label: '容器运行时可达' },
    { id: 'port-conflict', label: '端口占用' },
    { id: 'preset-image', label: '预制镜像就绪' },
  ],
  timeoutMs: 5000,
};
const DONE = { event: 'done', okCount: 2, infoCount: 1, warnCount: 0, failCount: 0, totalMs: 5012 };

function check(over: Record<string, unknown>): Record<string, unknown> {
  return {
    event: 'check',
    id: 'container-runtime',
    label: '容器运行时可达',
    status: 'ok',
    summary: 'ok',
    durationMs: 10,
    ...over,
  };
}

function serveDiagnose(chunks: readonly string[], opts: { hash?: string | null } = {}): void {
  server.use(
    http.post(`${API_BASE}/api/system/diagnose`, () => {
      const headers: Record<string, string> = { 'content-type': 'text/event-stream' };
      const hash = opts.hash === undefined ? 'sb-diagnose-v1' : opts.hash;
      if (hash !== null) headers['x-schema-hash'] = hash;
      return new HttpResponse(sseStream(chunks), { headers });
    }),
  );
}

interface Collected {
  starts: unknown[];
  checks: { id: string; status: string }[];
  dones: unknown[];
  mismatches: string[];
}

function collector(): { cb: Parameters<typeof diagnose>[0]; got: Collected } {
  const got: Collected = { starts: [], checks: [], dones: [], mismatches: [] };
  return {
    got,
    cb: {
      onStart: (f) => got.starts.push(f),
      onCheck: (f) => got.checks.push({ id: f.id, status: f.status }),
      onDone: (f) => got.dones.push(f),
      onSchemaMismatch: (h) => got.mismatches.push(h),
    },
  };
}

describe('diagnose() —— 逐项回调（container 与 view 不感知传输细节）', () => {
  it('① 帧按**到达顺序**逐条回调，并区分 start / check / done 三种', async () => {
    serveDiagnose([
      frameText(START),
      frameText(
        check({ id: 'preset-image', label: '预制镜像就绪', status: 'info', step: 'staged' }),
      ),
      frameText(check({ id: 'container-runtime' })),
      frameText(DONE),
    ]);
    const { cb, got } = collector();
    await diagnose(cb);

    expect(got.starts).toHaveLength(1);
    expect(got.dones).toHaveLength(1);
    // ⚠️ 到达顺序 ≠ 展示顺序：service 层**原样**回调（归位是上层按 id 做的事）。
    //    这里断言 `preset-image` 先于 `container-runtime`，正是"服务层不重排"的证据。
    expect(got.checks).toEqual([
      { id: 'preset-image', status: 'info' },
      { id: 'container-runtime', status: 'ok' },
    ]);
  });

  it('② 单项超时帧是**普通结果项**，后续帧继续到达（不中断整轮）', async () => {
    serveDiagnose([
      frameText(START),
      frameText(
        check({
          id: 'port-conflict',
          label: '端口占用',
          status: 'timeout',
          summary: '5 秒内没有结果',
        }),
      ),
      frameText(check({ id: 'container-runtime' })),
      frameText(DONE),
    ]);
    const { cb, got } = collector();
    await diagnose(cb);

    expect(got.checks[0]).toEqual({ id: 'port-conflict', status: 'timeout' });
    // ⚠️ 这条否定断言才是重点：把 timeout 当成"流坏了"而中止，上面那条肯定断言照样绿。
    expect(got.checks).toHaveLength(2);
    expect(got.dones).toHaveLength(1);
  });

  it('③ 断流（没有 done 帧）⇒ 抛 `DiagnoseStreamAborted`，**已到达项一条不少**', async () => {
    serveDiagnose([frameText(START), frameText(check({}))]);
    const { cb, got } = collector();

    await expect(diagnose(cb)).rejects.toBeInstanceOf(DiagnoseStreamAborted);
    // 已经回调过的项不因为后面断了而被撤回——上层据此保留结果 + 显示「诊断中断」。
    expect(got.starts).toHaveLength(1);
    expect(got.checks).toHaveLength(1);
    expect(got.dones).toHaveLength(0);
  });

  it('④ 收到 done 就**收工并关闭连接**，不等流自己结束（否则悬挂到天荒地老）', async () => {
    // ⚠️ 这条用一条**永不 close 的流**来证：真实 SSE 连接在服务端写完 `done` 之后不保证
    //    立刻 FIN（nginx / keep-alive 都可能让它挂着）。少了"收到 done 就停"，
    //    `diagnose()` 会一直 await 下一个分片 —— 界面上表现为诊断永远转圈，
    //    而八项结果其实早就全到了。这条会**超时红**，其余用例照旧全绿。
    const encoder = new TextEncoder();
    server.use(
      http.post(`${API_BASE}/api/system/diagnose`, () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(frameText(START)));
            controller.enqueue(encoder.encode(frameText(check({}))));
            controller.enqueue(encoder.encode(frameText(DONE)));
            // ⛔ 故意不 close：这正是真实连接里最常见的收尾。
          },
        });
        return new HttpResponse(stream, { headers: { 'content-type': 'text/event-stream' } });
      }),
    );
    const { cb, got } = collector();

    await diagnose(cb);

    expect(got.dones).toHaveLength(1);
    expect(got.checks).toHaveLength(1);
  }, 3000);

  it('⑤ 一帧被切成两个网络分片仍能解析（按分片解析会随机丢帧，且本机复现不了）', async () => {
    const whole = frameText(check({}));
    const cut = Math.floor(whole.length / 2);
    serveDiagnose([frameText(START), whole.slice(0, cut), whole.slice(cut), frameText(DONE)]);
    const { cb, got } = collector();
    await diagnose(cb);
    expect(got.checks).toEqual([{ id: 'container-runtime', status: 'ok' }]);
  });

  it('⑥ 认不出的帧只丢**那一帧**，其余照常（后端多说一句不许让前端一个字都收不到）', async () => {
    serveDiagnose([
      frameText(START),
      'event: future\ndata: {"event":"future","whatever":1}\n\n',
      'event: check\ndata: 这不是 JSON\n\n',
      frameText(check({})),
      frameText(DONE),
    ]);
    const { cb, got } = collector();
    await diagnose(cb);
    expect(got.checks).toHaveLength(1);
    expect(got.dones).toHaveLength(1);
  });

  it('⑦ `errorCode` 是**开放集合**：没见过的码原样带出，那一项照常渲染', async () => {
    const seen: (string | undefined)[] = [];
    serveDiagnose([
      frameText(START),
      frameText(
        check({
          id: 'preset-image',
          label: '预制镜像就绪',
          status: 'fail',
          errorCode: 'PRESET_IMAGE_SOMETHING_NEW_2027',
        }),
      ),
      frameText(DONE),
    ]);
    await diagnose({
      onStart: () => undefined,
      onCheck: (f) => seen.push(f.errorCode),
      onDone: () => undefined,
    });
    expect(seen).toEqual(['PRESET_IMAGE_SOMETHING_NEW_2027']);
  });

  it('⑧ `X-Schema-Hash` 对不上只**告知**，帧照常到达（⛔ 不中断一次只读诊断）', async () => {
    serveDiagnose([frameText(START), frameText(check({})), frameText(DONE)], {
      hash: 'sb-diagnose-v99',
    });
    const { cb, got } = collector();
    await diagnose(cb);

    expect(got.mismatches).toEqual(['sb-diagnose-v99']);
    // ⚠️ 否定式的那一半：把它做成"门"之后，上面那条肯定断言照样绿。
    expect(got.checks).toHaveLength(1);
    expect(got.dones).toHaveLength(1);
  });

  it('⑨ hash 一致时不打扰用户（不回调 onSchemaMismatch）', async () => {
    serveDiagnose([frameText(START), frameText(DONE)]);
    const { cb, got } = collector();
    await diagnose(cb);
    expect(got.mismatches).toEqual([]);
  });

  it('⑩ 非 2xx（失败路径回的是 JSON 信封不是流）⇒ 抛 ApiErrorException', async () => {
    server.use(
      http.post(`${API_BASE}/api/system/diagnose`, () =>
        HttpResponse.json(
          { code: 'INTERNAL', message: '诊断调度失败', retryable: true },
          { status: 500 },
        ),
      ),
    );
    const { cb } = collector();
    await expect(diagnose(cb)).rejects.toBeInstanceOf(ApiErrorException);
  });

  it('⑪ `signal` 中止 ⇒ 抛出（离开页面/重入时掐掉上一条流）', async () => {
    serveDiagnose([frameText(START), frameText(DONE)]);
    const controller = new AbortController();
    controller.abort();
    const { cb } = collector();
    await expect(diagnose(cb, controller.signal)).rejects.toThrow();
  });
});
