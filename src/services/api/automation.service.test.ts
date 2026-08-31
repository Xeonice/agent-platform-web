// 自动化 REST（10 §6.5）。MSW 驱动。
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import {
  createAutomation,
  deleteAutomation,
  getAutomationRun,
  listAutomationRuns,
  listAutomations,
  setAutomationEnabled,
  testWebhook,
  updateAutomation,
} from '@/services/api/automation.service';
import { ApiErrorException } from '@/services/api/apiError';

const BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

describe('automation.service · 基本读写', () => {
  it('列表按项目取，形状经 zod 校验', async () => {
    const rules = await listAutomations('proj-demo');
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0]?.projectId).toBe('proj-demo');
  });

  it('运行历史带 before / limit', async () => {
    let seen = '';
    server.use(
      http.get(`${BASE}/api/automations/:id/runs`, ({ request }) => {
        seen = new URL(request.url).search;
        return HttpResponse.json({ items: [], hasMore: false });
      }),
    );
    await listAutomationRuns('auto-1', 'run-77');
    expect(seen).toContain('before=run-77');
    expect(seen).toContain('limit=');
    expect(seen).toContain('limit=20');
  });

  it('单条 run 详情', async () => {
    const run = await getAutomationRun('run-1');
    expect(run.id).toBe('run-1');
  });

  it('enable / disable 打的是两个不同的端点', async () => {
    const hit: string[] = [];
    server.use(
      http.post(`${BASE}/api/automations/:id/enable`, ({ request }) => {
        hit.push(new URL(request.url).pathname);
        return HttpResponse.json({
          id: 'a',
          projectId: 'p',
          name: 'n',
          runtime: 'codex',
          prompt: 'x',
          scheduleKind: 'daily',
          scheduleConfig: { time: '08:00' },
          timezone: 'UTC',
          timeoutMinutes: 120,
          artifactRetentionDays: 7,
          enabled: true,
          degraded: false,
          consecutiveFailures: 0,
        });
      }),
    );
    await setAutomationEnabled('a', true);
    expect(hit[0]).toBe('/api/automations/a/enable');
  });

  it('DELETE 204 不解析响应体', async () => {
    await expect(deleteAutomation('auto-1')).resolves.toBeUndefined();
  });
});

describe('⭐⭐ 凭据策略：每个请求都必须带 credentials: include（11 §3.1 口令门）', () => {
  // ⚠️ 这条是**上一轮变异存活的那一条**：`credentials` 从 'include' 改成 'omit' 时，
  //    14 个用例照常全绿——因为没有一条真的去读它。MSW 的 `request.credentials`
  //    如实反映 fetch init，所以这里直接读它，改坏当场就红。
  const seen: Record<string, string> = {};

  function record(name: string) {
    return ({ request }: { request: Request }) => {
      seen[name] = request.credentials;
      return HttpResponse.json({
        id: 'a',
        projectId: 'p',
        name: 'n',
        runtime: 'codex',
        prompt: 'x',
        scheduleKind: 'daily',
        scheduleConfig: { time: '08:00' },
        timezone: 'UTC',
        timeoutMinutes: 120,
        artifactRetentionDays: 7,
        enabled: true,
        degraded: false,
        consecutiveFailures: 0,
      });
    };
  }

  it('8 个端点逐个断言', async () => {
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, ({ request }) => {
        seen['list'] = request.credentials;
        return HttpResponse.json([]);
      }),
      http.post(`${BASE}/api/projects/:id/automations`, record('create')),
      http.put(`${BASE}/api/automations/:id`, record('update')),
      http.delete(`${BASE}/api/automations/:id`, ({ request }) => {
        seen['remove'] = request.credentials;
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(`${BASE}/api/automations/:id/enable`, record('enable')),
      http.get(`${BASE}/api/automations/:id/runs`, ({ request }) => {
        seen['runs'] = request.credentials;
        return HttpResponse.json({ items: [], hasMore: false });
      }),
      http.get(`${BASE}/api/automations/runs/:runId`, ({ request }) => {
        seen['run'] = request.credentials;
        return HttpResponse.json({
          id: 'r',
          automationId: 'a',
          status: 'success',
          retryCount: 0,
          triggeredAt: '2026-08-31T00:00:00Z',
          startedAt: '2026-08-31T00:00:00Z',
        });
      }),
      http.post(`${BASE}/api/automations/webhook-test`, ({ request }) => {
        seen['webhookTest'] = request.credentials;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await listAutomations('p');
    await createAutomation('p', {
      name: 'n',
      runtime: 'codex',
      prompt: 'x',
      scheduleKind: 'daily',
      scheduleConfig: { time: '08:00' },
      timezone: 'UTC',
      timeoutMinutes: 120,
      artifactRetentionDays: 7,
    });
    await updateAutomation('a', {
      name: 'n',
      runtime: 'codex',
      prompt: 'x',
      scheduleKind: 'daily',
      scheduleConfig: { time: '08:00' },
      timeoutMinutes: 120,
      artifactRetentionDays: 7,
    });
    await deleteAutomation('a');
    await setAutomationEnabled('a', true);
    await listAutomationRuns('a', undefined);
    await getAutomationRun('r');
    await testWebhook('https://example.com/hook');

    expect(Object.keys(seen).sort()).toEqual(
      ['create', 'enable', 'list', 'remove', 'run', 'runs', 'update', 'webhookTest'].sort(),
    );
    for (const [name, credentials] of Object.entries(seen)) {
      expect(credentials, `${name} 少带了 credentials`).toBe('include');
    }
  });
});

describe('⭐ 契约漂移：形状不对宁可报错，也不半渲染', () => {
  it('列表少字段 → 抛 ApiErrorException（不是渲染一行 undefined）', async () => {
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () => HttpResponse.json([{ id: 'a' }])),
    );
    await expect(listAutomations('p')).rejects.toBeInstanceOf(ApiErrorException);
  });

  it('run 的 status 是契约外的值 → 抛（"enum 之外"必须炸，否则界面上是一格空白）', async () => {
    server.use(
      http.get(`${BASE}/api/automations/runs/:runId`, () =>
        HttpResponse.json({
          id: 'r',
          automationId: 'a',
          status: 'exploded',
          retryCount: 0,
          triggeredAt: '2026-08-31T00:00:00Z',
          startedAt: '2026-08-31T00:00:00Z',
        }),
      ),
    );
    await expect(getAutomationRun('r')).rejects.toBeInstanceOf(ApiErrorException);
  });

  it('后端错误信封原样带出来（人话文案由 hook 翻译）', async () => {
    server.use(
      http.post(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json(
          { code: 'AUTOMATION_LIMIT_REACHED', message: '规则数已达上限', retryable: false },
          { status: 409 },
        ),
      ),
    );
    await expect(
      createAutomation('p', {
        name: 'n',
        runtime: 'codex',
        prompt: 'x',
        scheduleKind: 'daily',
        scheduleConfig: { time: '08:00' },
        timezone: 'UTC',
        timeoutMinutes: 120,
        artifactRetentionDays: 7,
      }),
    ).rejects.toMatchObject({ httpStatus: 409 });
  });
});

describe('⭐ testWebhook 由后端代发', () => {
  it('打的是 /api/automations/webhook-test，而不是那个 URL 本身', async () => {
    const direct = vi.fn();
    server.use(
      http.post('https://evil.example.com/hook', () => {
        direct();
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(`${BASE}/api/automations/webhook-test`, async ({ request }) => {
        const body: unknown = await request.json();
        expect(body).toEqual({ url: 'https://evil.example.com/hook' });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await testWebhook('https://evil.example.com/hook');
    // 浏览器直连会带上用户 cookie、被 CORS 拦、且完全绕过后端 SSRF 判定（03 §8.5）。
    expect(direct).not.toHaveBeenCalled();
  });
});
