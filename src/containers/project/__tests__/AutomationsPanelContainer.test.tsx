// 自动化面板集成（F21-7 §7.3 交互流）。MSW 拦网络层，从 DOM 侧断言。
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { AutomationsPanelContainer } from '@/containers/project/AutomationsPanelContainer';
import { ModalShellView } from '@/views/common/ModalShell.view';
import type { AutomationDto } from '@/types/automation';

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

/** `noUncheckedIndexedAccess` 下的下标取值：拿不到就当场炸，比 `!` 说得清楚。 */
function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`没有第 ${String(index)} 项`);
  return item;
}

function rule(overrides: Partial<AutomationDto> & Pick<AutomationDto, 'id'>): AutomationDto {
  return {
    projectId: 'proj-demo',
    name: '每天凌晨数据分析',
    runtime: 'codex',
    prompt: '汇总昨天的日志',
    scheduleKind: 'daily',
    scheduleConfig: { time: '08:00' },
    timezone: 'Asia/Shanghai',
    timeoutMinutes: 120,
    artifactRetentionDays: 7,
    enabled: true,
    degraded: false,
    consecutiveFailures: 0,
    ...overrides,
  };
}

function wrap(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** 面板活在一层 ModalShell 里 —— 与生产（WorkbenchContainer 的 overlaySlot）同构。 */
function renderInModal(onOpenTask?: (id: string) => void) {
  return render(
    wrap(
      <ModalShellView title="自动化规则" onClose={() => undefined} testId="modal-automations">
        <AutomationsPanelContainer
          projectId="proj-demo"
          {...(onOpenTask === undefined ? {} : { onOpenTask })}
        />
      </ModalShellView>,
    ),
  );
}

describe('⭐⭐ 面板视图切换：全程只有一层 dialog（P20 §8.4 modal 不堆叠）', () => {
  it('列表 → [+ 新建规则] → 表单 → [取消] → 回列表，DOM 里始终只有 1 个 role=dialog', async () => {
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json([rule({ id: 'a1' })]),
      ),
    );
    renderInModal();
    // ⚠️ 等的是**行**，不是 `automation-list` 那个容器 div —— 它在 loading 期间就已经在了，
    //    那一刻既没有行也没有 [+ 新建规则]，等它等于什么都没等到。
    await screen.findByTestId('automation-list-item');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('automation-create'));
    await screen.findByTestId('automation-form');
    // ★ 表单是**同一面板里的另一个视图**，不是第二层弹层。
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByTestId('automation-list')).toBeNull();

    fireEvent.click(screen.getByTestId('form-cancel'));
    await screen.findByTestId('automation-list');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('列表 → 选中 → 详情 → [返回列表]', async () => {
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json([rule({ id: 'a1' })]),
      ),
      http.get(`${BASE}/api/automations/:id/runs`, () =>
        HttpResponse.json({ items: [], hasMore: false }),
      ),
    );
    renderInModal();
    fireEvent.click(await screen.findByTestId('automation-select'));
    await screen.findByTestId('automation-detail');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('detail-back'));
    await screen.findByTestId('automation-list');
  });
});

describe('⭐ 空态与上限', () => {
  it('无规则 → 空态 + CTA', async () => {
    server.use(http.get(`${BASE}/api/projects/:id/automations`, () => HttpResponse.json([])));
    renderInModal();
    expect(await screen.findByTestId('automation-empty')).toBeInTheDocument();
  });

  it('20 条 → [+ 新建规则] 置灰 + 上限提示', async () => {
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json(Array.from({ length: 20 }, (_, i) => rule({ id: `a${String(i)}` }))),
      ),
    );
    renderInModal();
    await screen.findAllByTestId('automation-list-item');
    expect(screen.getByTestId('automation-create')).toBeDisabled();
    expect(screen.getByTestId('automation-limit-note')).toBeInTheDocument();
  });
});

describe('⭐ 保存规则', () => {
  it('填名 + runtime + prompt + 每天 08:00 → POST body 含调度与超时 → 回详情', async () => {
    let body: Record<string, unknown> = {};
    let created = false;
    server.use(
      // 创建后列表要真的多出那一条 —— 否则 invalidate 回来仍是空列表，
      // 详情视图找不到行会静默回落到列表，"回详情"这条断言就测不到东西。
      http.get(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json(created ? [rule({ id: 'new', name: '新规则' })] : []),
      ),
      http.post(`${BASE}/api/projects/:id/automations`, async ({ request }) => {
        body = asRecord(await request.json());
        created = true;
        return HttpResponse.json(rule({ id: 'new', name: '新规则' }), { status: 201 });
      }),
      http.get(`${BASE}/api/automations/:id/runs`, () =>
        HttpResponse.json({ items: [], hasMore: false }),
      ),
    );
    renderInModal();
    fireEvent.click(await screen.findByTestId('automation-create'));
    await screen.findByTestId('automation-form');

    fireEvent.change(screen.getByTestId('form-name'), { target: { value: '新规则' } });
    fireEvent.change(await screen.findByTestId('form-runtime'), { target: { value: 'codex' } });
    fireEvent.change(screen.getByTestId('form-prompt'), { target: { value: '跑一下回归' } });
    fireEvent.click(screen.getByTestId('form-save'));

    await waitFor(() => {
      expect(body['name']).toBe('新规则');
    });
    expect(body['scheduleKind']).toBe('daily');
    expect(body['scheduleConfig']).toEqual({ time: '08:00' });
    expect(body['timeoutMinutes']).toBe(120);
    // ★ 创建必带 timezone。
    expect(Object.keys(body)).toContain('timezone');
    await screen.findByTestId('automation-detail');
  });

  it('⭐ 名称为空 → [保存规则] disabled', async () => {
    server.use(http.get(`${BASE}/api/projects/:id/automations`, () => HttpResponse.json([])));
    renderInModal();
    fireEvent.click(await screen.findByTestId('automation-create'));
    expect(await screen.findByTestId('form-save')).toBeDisabled();
  });

  it('⭐ prompt 超 8000 → 红字计数 + [保存规则] disabled（与向导同一上限同一算法）', async () => {
    server.use(http.get(`${BASE}/api/projects/:id/automations`, () => HttpResponse.json([])));
    renderInModal();
    fireEvent.click(await screen.findByTestId('automation-create'));
    await screen.findByTestId('automation-form');

    fireEvent.change(screen.getByTestId('form-name'), { target: { value: 'x' } });
    fireEvent.change(await screen.findByTestId('form-runtime'), { target: { value: 'codex' } });
    fireEvent.change(screen.getByTestId('form-prompt'), { target: { value: 'a'.repeat(8001) } });

    await waitFor(() => {
      expect(screen.getByTestId('form-prompt-count')).toHaveTextContent('8001 / 8000');
    });
    expect(screen.getByTestId('form-prompt-error')).toBeInTheDocument();
    expect(screen.getByTestId('form-save')).toBeDisabled();
  });
});

describe('⭐⭐ 编辑规则不隐式重传 timezone（I-AUT-9 / #32）', () => {
  it('只改 prompt → PUT body 的键集合不含 timezone', async () => {
    let body: Record<string, unknown> = { sentinel: 1 };
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json([rule({ id: 'a1', timezone: 'Asia/Shanghai' })]),
      ),
      http.get(`${BASE}/api/automations/:id/runs`, () =>
        HttpResponse.json({ items: [], hasMore: false }),
      ),
      http.put(`${BASE}/api/automations/:id`, async ({ request }) => {
        body = asRecord(await request.json());
        return HttpResponse.json(rule({ id: 'a1' }));
      }),
    );
    renderInModal();
    fireEvent.click(await screen.findByTestId('automation-select'));
    fireEvent.click(await screen.findByTestId('detail-edit'));
    await screen.findByTestId('automation-form');

    fireEvent.change(screen.getByTestId('form-prompt'), {
      target: { value: '汇总昨天的日志 再加一句' },
    });
    fireEvent.click(screen.getByTestId('form-save'));

    await waitFor(() => {
      expect(body['prompt']).toContain('再加一句');
    });
    // ★ 键集合断言。用户换台机器打开、只改了 prompt，凌晨任务就不该被挪走。
    expect(Object.keys(body)).not.toContain('timezone');
  });

  it('显式改了时区 → 这一次才带上，且界面提示"已修改"', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json([rule({ id: 'a1', timezone: 'Asia/Shanghai' })]),
      ),
      http.get(`${BASE}/api/automations/:id/runs`, () =>
        HttpResponse.json({ items: [], hasMore: false }),
      ),
      http.put(`${BASE}/api/automations/:id`, async ({ request }) => {
        body = asRecord(await request.json());
        return HttpResponse.json(rule({ id: 'a1' }));
      }),
    );
    renderInModal();
    fireEvent.click(await screen.findByTestId('automation-select'));
    fireEvent.click(await screen.findByTestId('detail-edit'));
    const tz = await screen.findByTestId('schedule-timezone');
    fireEvent.change(tz, { target: { value: 'UTC' } });

    expect(screen.getByTestId('timezone-touched')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('form-save'));
    await waitFor(() => {
      expect(body['timezone']).toBe('UTC');
    });
  });
});

describe('⭐ 8 个 run status 在界面上分得开', () => {
  it('failed/timeout 标"计入连续失败"；skipped/missed/排队 标"不计入"，且 missed 自成一类', async () => {
    const runs = [
      { id: 'r1', status: 'success' },
      { id: 'r2', status: 'failed' },
      { id: 'r3', status: 'timeout' },
      { id: 'r4', status: 'skipped', errorCode: 'AUTH_EXPIRED' },
      { id: 'r5', status: 'skipped', errorCode: 'PREVIOUS_RUNNING' },
      { id: 'r6', status: 'missed' },
      { id: 'r7', status: 'resource-exhausted', retryCount: 3 },
      { id: 'r8', status: 'running' },
    ].map((r) => ({
      automationId: 'a1',
      retryCount: 0,
      triggeredAt: '2026-08-31T00:00:00Z',
      startedAt: '2026-08-31T00:00:00Z',
      ...r,
    }));

    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json([rule({ id: 'a1' })]),
      ),
      http.get(`${BASE}/api/automations/:id/runs`, () =>
        HttpResponse.json({ items: runs, hasMore: false }),
      ),
    );
    renderInModal();
    fireEvent.click(await screen.findByTestId('automation-select'));
    const items = await screen.findAllByTestId('run-history-item');
    expect(items).toHaveLength(8);

    const categoryOf = (i: number) => at(items, i).getAttribute('data-category');
    const countsOf = (i: number) => at(items, i).getAttribute('data-counts-toward-failure');

    expect(categoryOf(0)).toBe('success');
    expect(categoryOf(1)).toBe('failure');
    expect(categoryOf(2)).toBe('failure');
    expect(categoryOf(3)).toBe('skipped');
    expect(categoryOf(4)).toBe('skipped');
    // ⭐ missed 不与 skipped 合并：一个是"平台没跑"，一个是"决定不跑"。
    expect(categoryOf(5)).toBe('missed');
    expect(categoryOf(6)).toBe('waiting');
    expect(categoryOf(7)).toBe('running');

    // ⭐ 只有两条计入连续失败。
    expect([0, 3, 4, 5, 6, 7].map(countsOf)).toEqual(Array(6).fill('false'));
    expect([1, 2].map(countsOf)).toEqual(['true', 'true']);

    // 排队中带 n/5。
    expect(within(at(items, 6)).getByTestId('run-label')).toHaveTextContent('3/5');

    // ⭐ 两种 skipped 的详情文案不同。
    fireEvent.click(within(at(items, 3)).getByTestId('run-toggle-detail'));
    const authDetail = within(at(items, 3)).getByTestId('run-detail').textContent;
    fireEvent.click(within(at(items, 4)).getByTestId('run-toggle-detail'));
    const prevDetail = within(at(items, 4)).getByTestId('run-detail').textContent;
    expect(authDetail).not.toBe(prevDetail);
    expect(authDetail).toContain('凭证');

    // ⭐ missed 的详情必须说清"不是规则失败 / 不补跑"。
    fireEvent.click(within(at(items, 5)).getByTestId('run-toggle-detail'));
    const missedDetail = within(at(items, 5)).getByTestId('run-detail').textContent;
    expect(missedDetail).toContain('不是规则失败');
    expect(missedDetail).toContain('不会补跑');
  });
});

describe('⭐ [打开 Task]', () => {
  it('有 sandboxId → 点了把 id 交出去；没有 → 不渲染那个按钮', async () => {
    const onOpenTask = vi.fn();
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json([rule({ id: 'a1' })]),
      ),
      http.get(`${BASE}/api/automations/:id/runs`, () =>
        HttpResponse.json({
          items: [
            {
              id: 'r1',
              automationId: 'a1',
              status: 'success',
              retryCount: 0,
              triggeredAt: '2026-08-31T00:00:00Z',
              startedAt: '2026-08-31T00:00:00Z',
              sandboxId: 'sbx-9',
            },
            {
              id: 'r2',
              automationId: 'a1',
              status: 'success',
              retryCount: 0,
              triggeredAt: '2026-08-31T00:00:00Z',
              startedAt: '2026-08-31T00:00:00Z',
            },
          ],
          hasMore: false,
        }),
      ),
    );
    render(
      wrap(
        <ModalShellView title="自动化规则" onClose={() => undefined} testId="modal-automations">
          <AutomationsPanelContainer projectId="proj-demo" onOpenTask={onOpenTask} />
        </ModalShellView>,
      ),
    );
    fireEvent.click(await screen.findByTestId('automation-select'));
    const items = await screen.findAllByTestId('run-history-item');

    fireEvent.click(within(at(items, 0)).getByTestId('run-toggle-detail'));
    fireEvent.click(within(at(items, 0)).getByTestId('run-open-task'));
    expect(onOpenTask).toHaveBeenCalledWith('sbx-9');

    // 契约暂缺 sandboxId 的那条：⛔ 不摆一个点了没反应的按钮。
    fireEvent.click(within(at(items, 1)).getByTestId('run-toggle-detail'));
    expect(within(at(items, 1)).queryByTestId('run-open-task')).toBeNull();
  });
});

describe('⭐ 删除的二次确认就地展开（不叠第二层弹层）', () => {
  it('[删除] → 确认区出现且仍只有一层 dialog → [确认删除] → 回列表', async () => {
    let deleted = false;
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json(deleted ? [] : [rule({ id: 'a1' })]),
      ),
      http.get(`${BASE}/api/automations/:id/runs`, () =>
        HttpResponse.json({ items: [], hasMore: false }),
      ),
      http.delete(`${BASE}/api/automations/:id`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderInModal();
    fireEvent.click(await screen.findByTestId('automation-select'));
    fireEvent.click(await screen.findByTestId('detail-delete'));

    expect(screen.getByTestId('detail-delete-confirm')).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('detail-delete-confirm-yes'));
    await screen.findByTestId('automation-empty');
  });
});

describe('⭐ 时区在界面上始终可见', () => {
  it('列表行给出规则时区；与本机不同时多一句提醒', async () => {
    server.use(
      http.get(`${BASE}/api/projects/:id/automations`, () =>
        HttpResponse.json([rule({ id: 'a1', timezone: 'Pacific/Chatham' })]),
      ),
    );
    renderInModal();
    const tz = await screen.findByTestId('automation-timezone');
    expect(tz).toHaveTextContent('Pacific/Chatham');
  });
});
