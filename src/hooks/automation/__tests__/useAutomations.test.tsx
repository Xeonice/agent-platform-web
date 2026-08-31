// 规则 hook（F21-7 §7.1 `useAutomations` ①–⑥）。MSW 驱动。
import { describe, it, expect } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { automationKeys, useAutomations } from '@/hooks/automation/useAutomations';
import { AUTOMATION_RULE_LIMIT, type AutomationDto } from '@/types/automation';

const BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

/**
 * `request.json()` 回的是 `unknown`。收成 `Record` 用 `Object.entries` 的结构性转换，
 * ⛔ 不用 `as`：本仓 lint 禁 `no-unsafe-type-assertion`，而断言在这里也确实没有依据
 * ——响应体是外部输入，"它一定是个对象"是假设不是事实。
 */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {};
  return Object.fromEntries(Object.entries(value));
}

function rule(overrides: Partial<AutomationDto> & Pick<AutomationDto, 'id'>): AutomationDto {
  return {
    projectId: 'proj-demo',
    name: 'r',
    runtime: 'codex',
    prompt: 'x',
    scheduleKind: 'daily',
    scheduleConfig: { time: '08:00' },
    timezone: 'Asia/Shanghai',
    timeoutMinutes: 120,
    artifactRetentionDays: 7,
    enabled: true,
    degraded: false,
    consecutiveFailures: 0,
    triggerOn: 'failure',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

function makeWrapper(): ({ children }: { children: ReactNode }) => React.JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('⭐ automationKeys（15 §2.1；本轮它第一次真的存在于代码里）', () => {
  it('分层原则 [资源域, 子类型, id/参数]，粗粒度在前', () => {
    expect(automationKeys.all()).toEqual(['automations']);
    expect(automationKeys.list('p1')).toEqual(['automations', 'list', { projectId: 'p1' }]);
    expect(automationKeys.runs('a1')).toEqual(['automations', 'runs', 'a1']);
    expect(automationKeys.run('r1')).toEqual(['automations', 'run', 'r1']);
  });

  it('每个项目一把 key：切项目不会读到上一个项目的缓存', () => {
    expect(automationKeys.list('a')).not.toEqual(automationKeys.list('b'));
  });

  it('⭐ runs 的 key **不带 page** —— 全部页共用一把，整体重取才不会拼成蒙太奇', () => {
    // 若 key 里带 page，第 1 页与第 2 页会是两个时刻的快照，
    // 中间新记的运行会让第 2 页的头几条重复第 1 页的尾几条（useAuditStream ① 同一个坑）。
    expect(automationKeys.runs('a1')).toHaveLength(3);
    expect(JSON.stringify(automationKeys.runs('a1'))).not.toContain('page');
  });

  it('all() 能整域失效（invalidateQueries 用得上）', () => {
    for (const key of [
      automationKeys.list('p'),
      automationKeys.runs('a'),
      automationKeys.run('r'),
    ]) {
      expect(key.slice(0, 1)).toEqual(automationKeys.all());
    }
  });
});

describe('useAutomations · 列表', () => {
  it('拿到行；行上有时区', async () => {
    const { result } = renderHook(() => useAutomations('proj-demo'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.rows.length).toBeGreaterThan(0);
    expect(result.current.rows[0]?.timezone).toBe('Asia/Shanghai');
  });

  it('⭐ projectId 为 null → 一个请求都不发、不报错、给空列表', async () => {
    // ⚠️ 变异测试（M29）打掉过这条用例的上一版：它只在
    //    `http.get('/api/projects/:id/automations')` 上挂 spy，而少了 `enabled` 守卫之后
    //    query 会带着空 id 去打 `/api/projects//automations` —— 那个路径**匹配不上**这条
    //    handler，spy 自然没被调用，用例照常绿。
    //    ⇒ 改成监听 MSW 的全局请求事件：只要发出去了，不管打到哪个 URL 都算数。
    const urls: string[] = [];
    const onRequest = ({ request }: { request: Request }): void => {
      urls.push(request.url);
    };
    server.events.on('request:start', onRequest);
    try {
      const { result } = renderHook(() => useAutomations(null), { wrapper: makeWrapper() });
      await act(async () => {
        await Promise.resolve();
      });
      expect(urls.filter((u) => u.includes('automations'))).toEqual([]);
      expect(result.current.rows).toEqual([]);
      expect(result.current.loading).toBe(false);
    } finally {
      server.events.removeListener('request:start', onRequest);
    }
  });

  it('⭐ 列表 500 → loadErrorMessage 有值，⛔ 不会被"空态"盖住', async () => {
    server.use(
      http.get(
        `${BASE}/api/projects/:id/automations`,
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    const { result } = renderHook(() => useAutomations('proj-demo'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.loadErrorMessage).toBeDefined();
    });
    // "取不回来"与"取回来是空的"必须能分开（useAuditStream ⑥ 同源）。
    expect(result.current.rows).toEqual([]);
  });
});

describe('⭐ atLimit（P21-7 §3.2：每项目 20 条）', () => {
  it('19 条不到上限，20 条到上限', async () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => rule({ id: `a${String(i)}` }));

    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json(make(AUTOMATION_RULE_LIMIT - 1)),
      ),
    );
    const under = renderHook(() => useAutomations('p'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(under.result.current.loading).toBe(false);
    });
    expect(under.result.current.atLimit).toBe(false);

    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json(make(AUTOMATION_RULE_LIMIT)),
      ),
    );
    const at = renderHook(() => useAutomations('p'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(at.result.current.loading).toBe(false);
    });
    expect(at.result.current.atLimit).toBe(true);
  });
});

describe('⭐ 启停乐观更新 + 失败回滚', () => {
  // ⚠️ **这条用例是变异测试逼出来的重写**（M17）：原版把 `onError` 里的回滚整行删掉之后
  //    照样全绿——因为 `onSettled` 的 `invalidateList()` 紧接着重新拉了一次列表，
  //    服务端的真实值把乐观值盖了回去，**回滚有没有都一样**。
  //    那等于这条用例根本没在测回滚，只是在测 invalidate。
  //    ⇒ 现在让**失败之后的列表刷新一直挂着不回**（真实场景：后端刚刚 500，下一个请求
  //    多半也不顺），此时能把界面救回来的**只有回滚**。
  it('点 [禁用] 立即灰显；500 → 回滚为启用（且不依赖 invalidate 兜底）', async () => {
    let listCalls = 0;
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, async () => {
        listCalls += 1;
        // 第 2 次及以后（= onSettled 触发的那次刷新）永不返回。
        if (listCalls > 1) await new Promise(() => undefined);
        return HttpResponse.json([rule({ id: 'a1', enabled: true })]);
      }),
      // 慢一点回，好让"乐观态"这一帧可观察——立即 500 的话回滚太快，
      // 断言不到中间态，那条断言就成了摆设。
      http.post(`${BASE}/api/automations/:id/disable`, async () => {
        await new Promise((r) => setTimeout(r, 50));
        return new HttpResponse(null, { status: 500 });
      }),
    );
    const { result } = renderHook(() => useAutomations('p'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.rows[0]?.lifecycle).toBe('on');
    });

    act(() => {
      result.current.toggle('a1', false);
    });
    // 乐观：立刻变禁用。
    await waitFor(() => {
      expect(result.current.rows[0]?.lifecycle).toBe('off');
    });
    // 失败后回滚 + 人话错误。
    await waitFor(() => {
      expect(result.current.rows[0]?.lifecycle).toBe('on');
    });
    expect(result.current.actionErrorMessage).toBeDefined();
  });

  it('⭐ [重新启用] 的乐观值必须同时解降频并清零计数（03 §8.4）', async () => {
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json([
          rule({ id: 'a1', enabled: false, degraded: true, consecutiveFailures: 10 }),
        ]),
      ),
      // 慢响应：让我们能观察到乐观态本身。
      http.post(`${BASE}/api/automations/:id/enable`, async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json(rule({ id: 'a1', enabled: true }));
      }),
    );
    const { result } = renderHook(() => useAutomations('p'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.rows[0]?.lifecycle).toBe('autoDisabled');
    });

    act(() => {
      result.current.toggle('a1', true);
    });
    // ⛔ 若只翻 enabled、把 10 次失败留在原地，这里会得到 'degraded'
    //    —— 一个"已启用但仍标着 🟡 降频"的状态，后端根本不会产生它。
    await waitFor(() => {
      expect(result.current.rows[0]?.lifecycle).toBe('on');
    });
    expect(result.current.rows[0]?.consecutiveFailures).toBe(0);
  });
});

describe('⭐ 保存后 invalidate list', () => {
  it('创建成功 → 列表重新拉一次', async () => {
    let listCalls = 0;
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () => {
        listCalls += 1;
        return HttpResponse.json([]);
      }),
      http.post(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json(rule({ id: 'new' }), { status: 201 }),
      ),
    );
    const { result } = renderHook(() => useAutomations('p'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(listCalls).toBe(1);
    });

    await act(async () => {
      await result.current.create({
        name: 'n',
        runtime: 'codex',
        prompt: 'x',
        scheduleKind: 'daily',
        scheduleConfig: { time: '08:00' },
        timezone: 'UTC',
        timeoutMinutes: 120,
        artifactRetentionDays: 7,
      });
    });
    await waitFor(() => {
      expect(listCalls).toBe(2);
    });
  });

  it('删除失败（404）也 invalidate：那条真的没了，列表必须跟着更新', async () => {
    let listCalls = 0;
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () => {
        listCalls += 1;
        return HttpResponse.json([rule({ id: 'a1' })]);
      }),
      http.delete(`${BASE}/api/automations/:id`, () => new HttpResponse(null, { status: 404 })),
    );
    const { result } = renderHook(() => useAutomations('p'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(listCalls).toBe(1);
    });
    await act(async () => {
      await result.current.remove('a1').catch(() => undefined);
    });
    await waitFor(() => {
      expect(listCalls).toBe(2);
    });
    expect(result.current.actionErrorMessage).toContain('已经不存在');
  });
});

describe('⭐⭐ 创建带 timezone / 编辑不带 timezone（I-AUT-9 的前端侧防线）', () => {
  it('创建请求体含 timezone', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () => HttpResponse.json([])),
      http.post(`${BASE}/api/projects/:id/automations`, async ({ request }) => {
        body = asRecord(await request.json());
        return HttpResponse.json(rule({ id: 'new' }), { status: 201 });
      }),
    );
    const { result } = renderHook(() => useAutomations('p'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    await act(async () => {
      await result.current.create({
        name: 'n',
        runtime: 'codex',
        prompt: 'x',
        scheduleKind: 'daily',
        scheduleConfig: { time: '08:00' },
        timezone: 'Asia/Shanghai',
        timeoutMinutes: 120,
        artifactRetentionDays: 7,
      });
    });
    expect(Object.keys(body)).toContain('timezone');
  });

  it('⭐ 编辑请求体的**键集合**不含 timezone（走 buildUpdatePayload 时）', async () => {
    let body: Record<string, unknown> = { sentinel: 1 };
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json([rule({ id: 'a1' })]),
      ),
      http.put(`${BASE}/api/automations/:id`, async ({ request }) => {
        body = asRecord(await request.json());
        return HttpResponse.json(rule({ id: 'a1' }));
      }),
    );
    const { result } = renderHook(() => useAutomations('p'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    await act(async () => {
      await result.current.update('a1', {
        name: 'n',
        runtime: 'codex',
        prompt: 'x',
        scheduleKind: 'daily',
        scheduleConfig: { time: '08:00' },
        timeoutMinutes: 120,
        artifactRetentionDays: 7,
      });
    });
    // ★ 断言键集合，不是值：值相等的断言会放过"传了一个恰好相同的时区"。
    expect(Object.keys(body)).not.toContain('timezone');
  });
});

describe('webhook 测试连接', () => {
  it('成功 → phase ok；失败 → phase error 且带人话', async () => {
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () => HttpResponse.json([])),
      http.post(`${BASE}/api/automations/webhook-test`, () =>
        HttpResponse.json({ ok: true, message: '目标返回 200' }),
      ),
    );
    const { result } = renderHook(() => useAutomations('p'), { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    await act(async () => {
      await result.current.sendWebhookTest('https://x/y');
    });
    expect(result.current.webhookTestState.phase).toBe('ok');

    server.use(
      http.post(`${BASE}/api/automations/webhook-test`, () =>
        HttpResponse.json(
          { code: 'WEBHOOK_UNREACHABLE', message: '目标地址不可达', retryable: true },
          { status: 502 },
        ),
      ),
    );
    await act(async () => {
      await result.current.sendWebhookTest('https://x/y').catch(() => undefined);
    });
    expect(result.current.webhookTestState).toMatchObject({
      phase: 'error',
      message: '目标地址不可达',
    });
  });
});
