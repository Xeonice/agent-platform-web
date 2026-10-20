import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { API, NOW, body, online, project, provider } from './support/fixtures';
import { server } from './support/server';
import { queryHarness } from './support/mount';
import { AppFrameContainer } from '@/containers/workbench/AppFrameContainer';
import { SandboxTerminalContainer } from '@/containers/sandbox/SandboxTerminalContainer';
import { GlobalBannerContainer } from '@/containers/banner/GlobalBannerContainer';
import { useGlobalBanner } from '@/hooks/system/useGlobalBanner';
import { useSystemStatus } from '@/hooks/system/useSystemStatus';
import { useInitGate } from '@/hooks/system/useInitGate';
import { systemKeys } from '@/hooks/system/useAuditStream';
import { connectivityCheckModel } from '@/lib/system/connectivityVerdict';
import { useAppStore } from '@/stores';
import type { ConnectivityResultDto } from '@/types/init';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/sandbox/useSandboxEventsSocket', () => ({
  useSandboxEventsSocket: () => ({ connState: 'open', attempt: 0 }),
}));
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  );
});

const failed: ConnectivityResultDto[] = [
  { target: 'declared-probe.invalid', ok: false, modelApi: true, hint: 'DNS 解析失败' },
  { target: 'registry-probe.invalid', ok: false, modelApi: false },
];
const checkedAt = '2000-01-01T08:00:00.000Z';
type Snapshot = 'history' | 'diagnostic' | 'unknown' | 'empty';

async function setup(snapshot: Snapshot) {
  const harness = queryHarness();
  const initReads = vi.fn();
  const diagnoses = vi.fn();
  server.use(
    http.get(`${API}/api/projects`, () => HttpResponse.json([project()])),
    http.get(`${API}/api/system/init-status`, () => {
      initReads();
      if (snapshot === 'empty') return HttpResponse.json({ initialized: true });
      return snapshot === 'unknown'
        ? HttpResponse.json(
            { code: 'INTERNAL', message: 'unavailable', retryable: true },
            { status: 500 },
          )
        : HttpResponse.json({
            initialized: true,
            lastConnectivityCheck: snapshot === 'history' ? failed : online,
            lastConnectivityCheckAt: snapshot === 'history' ? checkedAt : NOW,
          });
    }),
    http.post(`${API}/api/system/diagnose`, () => {
      diagnoses();
      const frames = [
        {
          event: 'start',
          checks: [{ id: 'outbound-network', label: '联网检查' }],
          timeoutMs: 1000,
        },
        {
          event: 'check',
          id: 'outbound-network',
          label: '联网检查',
          status: 'fail',
          headline: '声明目标未连通',
          durationMs: 50,
          detail: { results: failed },
        },
        { event: 'done', okCount: 0, infoCount: 0, warnCount: 0, failCount: 1, totalMs: 50 },
      ];
      return new HttpResponse(
        frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
        {
          headers: { 'Content-Type': 'text/event-stream' },
        },
      );
    }),
  );
  if (snapshot === 'diagnostic') {
    const owner = renderHook(() => useSystemStatus(), { wrapper: harness.wrapper });
    act(() => {
      owner.result.current.runDiagnose();
    });
    await waitFor(() => {
      expect(owner.result.current.diagnoseState?.phase).toBe('done');
    });
    owner.unmount();
  }
  return { ...harness, initReads, diagnoses };
}

async function workbench(snapshot: Snapshot) {
  const harness = await setup(snapshot);
  useAppStore.setState({ selectedProjectId: 'project-a' });
  const mounted = render(
    <AppFrameContainer>
      <SandboxTerminalContainer
        wsBaseUrl="ws://localhost:3001"
        projectId="project-a"
        projectName="acme-web"
        projectSourceType="git"
        projects={[project()]}
      />
    </AppFrameContainer>,
    { wrapper: harness.wrapper },
  );
  await waitFor(() => {
    expect(screen.getByTestId('new-task-entry')).toBeEnabled();
  });
  if (snapshot === 'empty') {
    await waitFor(() => {
      expect(harness.client.getQueryState(systemKeys.init())?.status).toBe('success');
    });
  } else {
    await screen.findByText(snapshot === 'unknown' ? '无法确认平台状态' : '联网检查未通过');
  }
  return { ...harness, ...mounted };
}

const entries = ['header', 'empty-project', 'command-palette'] as const;
async function openTask(entry: (typeof entries)[number]) {
  if (entry === 'header') {
    const button = screen.getByTestId('new-task-entry');
    expect(button).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(button);
  } else if (entry === 'empty-project') {
    const button = screen.getByRole('button', { name: '发起第一个任务' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
  } else {
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const search = await screen.findByRole('combobox', { name: '查找任务、项目与动作' });
    fireEvent.change(search, { target: { value: '新任务' } });
    const action = screen.getByRole('option', { name: '新任务…' });
    expect(action).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(action);
  }
  await screen.findByTestId('modal-new-task');
  expect(useAppStore.getState().currentModal).toBe('newTask');
}

describe('diagnostic snapshots describe their targets, never task admission', () => {
  for (const snapshot of ['history', 'diagnostic', 'unknown', 'empty'] as const) {
    it.each(entries)(
      `${snapshot}: %s opens the real task form without repeating diagnostics`,
      async (entry) => {
        const harness = await workbench(snapshot);
        await openTask(entry);
        expect(harness.initReads).toHaveBeenCalledOnce();
        expect(harness.diagnoses).toHaveBeenCalledTimes(snapshot === 'diagnostic' ? 1 : 0);
        if (snapshot === 'empty') {
          expect(screen.queryByTestId('banner-offline')).not.toBeInTheDocument();
          expect(screen.queryByTestId('banner-platform-state-unknown')).not.toBeInTheDocument();
          return;
        }
        const banner = screen.getByTestId(
          snapshot === 'unknown' ? 'banner-platform-state-unknown' : 'banner-offline',
        );
        expect(banner).not.toHaveTextContent('Agent 将不可用');
        if (snapshot === 'history') {
          expect(banner).toHaveTextContent('2000-01-01');
          expect(banner).toHaveTextContent('上次检查记录');
        } else if (snapshot === 'diagnostic') {
          expect(banner).toHaveTextContent('检测时刻未提供');
          expect(banner).toHaveTextContent('诊断检查记录');
          expect(banner).not.toHaveTextContent('刚');
          expect(banner).not.toHaveTextContent('2000-01-01');
        }
      },
    );
  }

  it('a failed snapshot permits POST, while a real backend admission rejection retains its error and creates no task', async () => {
    const creates = vi.fn();
    server.use(
      http.post(`${API}/api/sandboxes`, async ({ request }) => {
        creates(await body(request));
        return HttpResponse.json(
          {
            code: 'PROJECT_NOT_READY',
            message: 'not ready',
            retryable: false,
            sideEffectFree: true,
          },
          { status: 409 },
        );
      }),
    );
    await workbench('history');
    await openTask('empty-project');
    fireEvent.click(await screen.findByRole('radio', { name: /Codex/ }));
    const primary = screen.getByRole('button', { name: '发起任务并打开终端' });
    await waitFor(() => {
      expect(primary).toHaveAttribute('aria-disabled', 'false');
    });
    fireEvent.click(primary);
    await screen.findByText(/本次请求未创建任何任务/);
    expect(creates).toHaveBeenCalledExactlyOnceWith({ projectId: 'project-a', runtime: 'codex' });
    expect(screen.getByTestId('modal-new-task')).toBeInTheDocument();
    expect(useAppStore.getState().selectedSandboxId).toBeNull();
  });

  it('removing snapshot admission preserves the actual provider TTY prerequisite', async () => {
    const creates = vi.fn();
    server.use(
      http.get(`${API}/api/providers`, () =>
        HttpResponse.json([
          { ...provider, capabilities: { ...provider.capabilities, spawnTty: false } },
        ]),
      ),
      http.post(`${API}/api/sandboxes`, () => {
        creates();
        return HttpResponse.json({});
      }),
    );
    await workbench('diagnostic');
    await openTask('header');
    fireEvent.click(await screen.findByRole('radio', { name: /Codex/ }));
    const primary = screen.getByRole('button', { name: '发起任务并打开终端' });
    expect(primary).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(primary);
    expect(screen.getByTestId('modal-new-task')).toHaveTextContent('开不了终端');
    expect(creates).not.toHaveBeenCalled();
  });

  it('cached diagnosis does not swallow a failed platform read, and retryOnMount does not restart initialization', async () => {
    const harness = await setup('diagnostic');
    server.use(
      http.get(`${API}/api/system/init-status`, () => {
        harness.initReads();
        return HttpResponse.json(
          { code: 'INTERNAL', message: 'failed', retryable: true },
          { status: 500 },
        );
      }),
    );
    const first = render(<GlobalBannerContainer />, { wrapper: harness.wrapper });
    await screen.findByText('无法确认平台状态');
    expect(screen.getByText('联网检查未通过')).toBeInTheDocument();
    first.unmount();
    const boot = renderHook(() => useInitGate(), { wrapper: harness.wrapper });
    await waitFor(() => {
      expect(boot.result.current.isError).toBe(true);
    });
    render(<GlobalBannerContainer />, { wrapper: harness.wrapper });
    await screen.findByText('无法确认平台状态');
    expect(harness.initReads).toHaveBeenCalledOnce();
    expect(harness.diagnoses).toHaveBeenCalledOnce();
  });

  it('snapshot absence does not imply connected, disconnected or blocked, and remount reuses the one initialization read', async () => {
    const harness = await setup('history');
    server.use(
      http.get(`${API}/api/system/init-status`, () => {
        harness.initReads();
        return HttpResponse.json({ initialized: true });
      }),
    );
    const first = renderHook(() => useGlobalBanner('/'), { wrapper: harness.wrapper });
    await waitFor(() => {
      expect(harness.client.getQueryState(systemKeys.init())?.status).toBe('success');
    });
    expect(first.result.current.model.banners).toEqual([]);
    first.unmount();
    const second = renderHook(() => useGlobalBanner('/'), { wrapper: harness.wrapper });
    expect(second.result.current.model.banners).toEqual([]);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(harness.initReads).toHaveBeenCalledOnce();
    expect(harness.diagnoses).not.toHaveBeenCalled();
    const model = connectivityCheckModel({ rows: undefined, fromHistory: true });
    expect(model.hasResult).toBe(false);
    expect(model.verdictText).toContain('待确认');
  });

  it('a successful new diagnosis removes a failed-history warning without changing task admission or rewriting historical facts', async () => {
    const harness = await workbench('history');
    server.use(
      http.post(`${API}/api/system/diagnose`, () => {
        harness.diagnoses();
        const frames = [
          {
            event: 'start',
            checks: [{ id: 'outbound-network', label: '联网检查' }],
            timeoutMs: 1000,
          },
          {
            event: 'check',
            id: 'outbound-network',
            label: '联网检查',
            status: 'ok',
            headline: '本次目标通过',
            durationMs: 5,
            detail: { results: online },
          },
          { event: 'done', okCount: 1, infoCount: 0, warnCount: 0, failCount: 0, totalMs: 5 },
        ];
        return new HttpResponse(
          frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
          {
            headers: { 'Content-Type': 'text/event-stream' },
          },
        );
      }),
    );
    const owner = renderHook(() => useSystemStatus(), { wrapper: harness.wrapper });
    act(() => {
      owner.result.current.runDiagnose();
    });
    await waitFor(() => {
      expect(owner.result.current.diagnoseState?.phase).toBe('done');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('banner-offline')).not.toBeInTheDocument();
    });
    expect(harness.client.getQueryData(systemKeys.init())).toMatchObject({
      lastConnectivityCheck: failed,
      lastConnectivityCheckAt: checkedAt,
    });
    expect(harness.diagnoses).toHaveBeenCalledOnce();
    await openTask('header');
  });

  it('failed historical targets without checkedAt remain unknown in time and permit task admission', async () => {
    const harness = await workbench('history');
    server.use(
      http.get(`${API}/api/system/init-status`, () => {
        harness.initReads();
        return HttpResponse.json({ initialized: true, lastConnectivityCheck: failed });
      }),
    );
    await act(async () => {
      await harness.client.invalidateQueries({ queryKey: systemKeys.init() });
    });
    const banner = screen.getByTestId('banner-offline');
    await waitFor(() => {
      expect(banner).toHaveTextContent('检测时刻未提供');
    });
    expect(banner).toHaveTextContent('上次检查记录');
    expect(banner).not.toHaveTextContent('2000-01-01');
    expect(banner).not.toHaveTextContent('刚');
    await openTask('command-palette');
    expect(harness.diagnoses).not.toHaveBeenCalled();
  });

  it.each(['start-only', 'invalid-outbound-detail'] as const)(
    '%s diagnosis retains the failed historical snapshot while the real diagnostic stream is in progress',
    async (mode) => {
      const harness = await workbench('history');
      const encoder = new TextEncoder();
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      server.use(
        http.post(`${API}/api/system/diagnose`, () => {
          harness.diagnoses();
          return new HttpResponse(
            new ReadableStream<Uint8Array>({
              start(value) {
                controller = value;
                const frames = [
                  {
                    event: 'start',
                    checks: [{ id: 'outbound-network', label: '联网检查' }],
                    timeoutMs: 1000,
                  },
                  ...(mode === 'start-only'
                    ? []
                    : [
                        {
                          event: 'check',
                          id: 'outbound-network',
                          label: '联网检查',
                          status: 'fail',
                          headline: '目标详情格式不兼容',
                          durationMs: 5,
                          detail: { results: 'unrecognized' },
                        },
                      ]),
                ];
                for (const frame of frames)
                  value.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
              },
            }),
            { headers: { 'Content-Type': 'text/event-stream' } },
          );
        }),
      );
      const owner = renderHook(() => useSystemStatus(), { wrapper: harness.wrapper });
      act(() => {
        owner.result.current.runDiagnose();
      });
      try {
        await waitFor(() => {
          expect(owner.result.current.diagnoseState?.checks[0]?.id).toBe('outbound-network');
        });
        if (mode === 'invalid-outbound-detail') {
          await waitFor(() => {
            expect(owner.result.current.diagnoseState?.results['outbound-network']?.detail).toEqual(
              { results: 'unrecognized' },
            );
          });
        }
        expect(owner.result.current.diagnoseState?.phase).toBe('running');
        const banner = screen.getByTestId('banner-offline');
        expect(banner).toHaveTextContent('2000-01-01');
        expect(banner).toHaveTextContent('上次检查记录');
        expect(banner).not.toHaveTextContent('诊断检查记录');
        expect(banner).not.toHaveTextContent('检测时刻未提供');
        await openTask('empty-project');
      } finally {
        if (controller !== undefined) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ event: 'done', okCount: 0, infoCount: 0, warnCount: 0, failCount: mode === 'start-only' ? 0 : 1, totalMs: 5 })}\n\n`,
            ),
          );
          controller.close();
        }
      }
      await waitFor(() => {
        expect(owner.result.current.diagnoseState?.phase).toBe('done');
      });
      expect(harness.diagnoses).toHaveBeenCalledOnce();
    },
  );

  it.each(['rerender', 'remount'] as const)(
    'a warning dismissed today returns on next local day %s without a diagnostic or snapshot reload',
    async (mode) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-18T23:59:50'));
      const harness = await setup('history');
      const hook = renderHook(() => useGlobalBanner('/'), { wrapper: harness.wrapper });
      await waitFor(() => {
        expect(harness.client.isFetching()).toBe(0);
      });
      await waitFor(() => {
        expect(hook.result.current.model.banners.some((banner) => banner.id === 'offline')).toBe(
          true,
        );
      });
      act(() => {
        hook.result.current.dismiss('offline');
      });
      expect(hook.result.current.model.banners.some((banner) => banner.id === 'offline')).toBe(
        false,
      );
      expect(useAppStore.getState().bannerDismissedToday['offline']).toBe('2026-10-18');
      const snapshot = harness.client.getQueryData(systemKeys.init());
      vi.setSystemTime(new Date('2026-10-19T00:00:01'));
      if (mode === 'rerender') {
        hook.rerender();
        expect(hook.result.current.model.banners.some((banner) => banner.id === 'offline')).toBe(
          true,
        );
      } else {
        hook.unmount();
        const next = renderHook(() => useGlobalBanner('/'), { wrapper: harness.wrapper });
        expect(next.result.current.model.banners.some((banner) => banner.id === 'offline')).toBe(
          true,
        );
      }
      expect(harness.client.getQueryData(systemKeys.init())).toBe(snapshot);
      expect(harness.initReads).toHaveBeenCalledOnce();
      expect(harness.diagnoses).not.toHaveBeenCalled();
    },
  );

  it.each([
    { label: 'all passed', rows: online, verdict: 'ok' },
    { label: 'all declared model targets failed', rows: failed, verdict: 'offline' },
    {
      label: 'registry only failed',
      rows: online.map((row) => ({ ...row, ok: row.modelApi })),
      verdict: 'partial',
    },
    {
      label: 'some model targets failed',
      rows: online.map((row, i) => ({ ...row, ok: i !== 0 })),
      verdict: 'partial',
    },
    {
      label: 'all timed out',
      rows: failed.map((row) => ({ ...row, timedOut: true })),
      verdict: 'partial',
    },
    {
      label: 'registry targets only',
      rows: failed.filter((row) => !row.modelApi),
      verdict: 'partial',
    },
  ])('$label remains scoped to its declared probe targets', ({ rows, verdict }) => {
    const model = connectivityCheckModel({ rows, fromHistory: false });
    expect(model.verdict).toBe(verdict);
    expect(model.verdictText).toContain('本次');
    expect(model.verdictText).toContain('任务实际连通性以其配置和执行结果为准');
    expect(model.verdictText).not.toMatch(/Agent (?:将不可用|不可用|可用)/);
    expect(model.checkedAtText).toBeUndefined();
    expect(model.rows.map((row) => row.target)).toEqual(rows.map((row) => row.target));
  });

  it('failed-target governance can be dismissed for today without altering the snapshot or task entry', async () => {
    const harness = await workbench('history');
    fireEvent.click(screen.getByRole('button', { name: '今天不再提示「联网检查未通过」' }));
    await waitFor(() => {
      expect(screen.queryByTestId('banner-offline')).not.toBeInTheDocument();
    });
    expect(useAppStore.getState().bannerDismissedToday['offline']).toBeDefined();
    expect(harness.client.getQueryData(systemKeys.init())).toMatchObject({
      lastConnectivityCheck: failed,
      lastConnectivityCheckAt: checkedAt,
    });
    await openTask('header');
  });
});
