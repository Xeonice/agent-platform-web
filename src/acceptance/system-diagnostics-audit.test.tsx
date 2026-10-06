import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { SystemStatusContainer } from '@/containers/system/SystemStatusContainer';
import { AuditStreamContainer } from '@/containers/system/AuditStreamContainer';
import { server } from '@/acceptance/support/server';
import type { SystemProvidersDto, SystemResourcesDto, SystemSettingsDto } from '@/types/system';
import type { AuditListDto } from '@/types/audit';
import { DIAGNOSE_CHECK_IDS } from '@/types/sse-protocol';

const base = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const gb = 1024 ** 3;
const resources: SystemResourcesDto = {
  cpu: { cores: 8, loadAvg1m: 0.8, usedPercent: 10, level: 'ok' },
  ram: { totalBytes: 16 * gb, usedBytes: 3 * gb, usedPercent: 18.75, level: 'ok' },
  disk: {
    path: '/actual/data',
    totalBytes: 200 * gb,
    usedBytes: 192 * gb,
    availableBytes: 8 * gb,
    usedPercent: 96,
    level: 'critical',
    reservedPercent: 15,
  },
  retainedVolumes: {
    count: 3,
    totalBytes: 164 * gb,
    percentOfDisk: 82,
    level: 'critical',
    truncated: false,
  },
  activeTasks: 2,
  capacity: {
    remainingTasks: 0,
    registeredTasks: 10,
    maxTasks: 10,
    basis: '已登记任务，包括已停止任务',
  },
};
const providers: SystemProvidersDto = {
  providers: [
    {
      id: 'aio',
      isDefault: true,
      healthy: false,
      recentFailureRate: 0.12,
      sampleSize: 100,
      failureCount: 12,
      capabilities: {
        spawnTty: true,
        volumeMount: true,
        updateResources: false,
        pauseResume: false,
        snapshot: false,
        watchEvents: true,
        headlessTask: true,
      },
    },
  ],
  runtimes: [],
  imageSpecs: [],
  healthWindowMs: 3_600_000,
  healthWarnRate: 0.01,
  healthErrorRate: 0.1,
};
const settings: SystemSettingsDto = {
  initialized: true,
  accessPasscodeEnabled: false,
  version: { platform: '0.2.4', node: '22' },
  proxyConfig: { noProxy: 'localhost' },
};
function mount(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
function frame(value: Record<string, unknown>) {
  return `event: ${String(value['event'])}\ndata: ${JSON.stringify(value)}\n\n`;
}
beforeEach(() => {
  cleanup();
  server.use(
    http.get(`${base}/api/system/resources`, () => HttpResponse.json(resources)),
    http.get(`${base}/api/system/providers`, () => HttpResponse.json(providers)),
    http.get(`${base}/api/system/settings`, () => HttpResponse.json(settings)),
  );
});

describe('SYS/DIA/AUD current production acceptance', () => {
  it('AC-SYS-030.7: a failed provider read ends all loading blocks and retains the diagnosis action', async () => {
    server.use(
      http.get(`${base}/api/system/providers`, () =>
        HttpResponse.json(
          { code: 'INTERNAL', message: 'unavailable', retryable: true },
          { status: 500 },
        ),
      ),
    );
    const { container } = mount(<SystemStatusContainer />);
    await screen.findByText(/沙箱环境概览读取失败/);
    const card = container.querySelector('section[aria-labelledby="sandbox-env-status-heading"]');
    expect(card).toHaveAttribute('aria-busy', 'false');
    expect(card?.querySelector('.animate-pulse')).toBeNull();
    expect(screen.getByRole('button', { name: '重新诊断' })).toBeEnabled();
  });

  it('AC-SYS-030.5/020.1/071.1: exact capacity and retained share come from REST; provider logs only load on the clicked entry', async () => {
    const logs = vi.fn();
    const cleanupArtifacts = vi.fn();
    server.use(
      http.get(`${base}/api/system/providers/aio/logs`, () => {
        logs();
        return HttpResponse.json({ lines: ['actual aio stopped container'] });
      }),
    );
    mount(<SystemStatusContainer onCleanupRetained={cleanupArtifacts} />);
    await screen.findByText('还能再发 0 个任务');
    expect(screen.getByText(/已登记任务，包括已停止任务/)).toBeInTheDocument();
    expect(screen.getByText('保留下来的成果已占数据目录的 82%，建议手动清理')).toBeInTheDocument();
    expect(logs).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '清理成果' }));
    expect(cleanupArtifacts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '查看日志' }));
    await screen.findByText('actual aio stopped container');
    expect(logs).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '重新诊断' })).toBeEnabled();
  });

  it('AC-SYS-060.4/060.8: format rejection stays beside its actual input, editing clears it and a successful retry is announced', async () => {
    let attempts = 0;
    server.use(
      http.put(`${base}/api/system/settings`, () =>
        ++attempts === 1
          ? HttpResponse.json(
              {
                code: 'VALIDATION_FAILED',
                message: 'schema internals',
                retryable: false,
                details: [
                  {
                    path: 'proxyConfig.httpProxy',
                    code: 'custom',
                    message: 'HTTP_PROXY 要以 http:// 或 https:// 开头',
                  },
                ],
              },
              { status: 400 },
            )
          : HttpResponse.json({
              ...settings,
              proxyConfig: { httpProxy: 'http://localhost:7890' },
            } satisfies SystemSettingsDto),
      ),
    );
    mount(<SystemStatusContainer />);
    const input = await screen.findByRole('textbox', { name: 'HTTP_PROXY' });
    fireEvent.change(input, { target: { value: 'socks5://localhost:7890' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => {
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });
    expect(document.getElementById(input.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      'HTTP_PROXY 要以 http:// 或 https:// 开头',
    );
    expect(document.body.textContent).not.toContain('schema internals');
    fireEvent.change(input, { target: { value: 'http://localhost:7890' } });
    await waitFor(() => {
      expect(input).not.toHaveAttribute('aria-invalid', 'true');
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('已保存。下一轮联网检查会走这组代理。');
    expect(attempts).toBe(2);
  });

  it('AC-DIA-050.1/050.3/030.1: a stream ending after five actual results retains them and labels all other rows 未返回 without spinners', async () => {
    const checks = DIAGNOSE_CHECK_IDS.map((id, index) => ({
      id,
      label: `实际检查 ${String(index + 1)}`,
    }));
    const data =
      frame({ event: 'start', checks, timeoutMs: 10_000 }) +
      checks
        .slice(0, 5)
        .map(({ id, label }) =>
          frame({
            event: 'check',
            id,
            label,
            status: 'ok',
            headline: `${label}已通过`,
            durationMs: 1,
          }),
        )
        .join('');
    server.use(
      http.post(
        `${base}/api/system/diagnose`,
        () => new HttpResponse(data, { headers: { 'content-type': 'text/event-stream' } }),
      ),
    );
    mount(<SystemStatusContainer />);
    fireEvent.click(screen.getByRole('button', { name: '重新诊断' }));
    await screen.findByTestId('diagnose-aborted');
    expect(screen.getAllByText('未返回')).toHaveLength(4);
    expect(screen.getByText(/⑤/)).toBeInTheDocument();
    expect(screen.getByText(/⑨/)).toBeInTheDocument();
    expect(screen.queryByText('检测中')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出日志' })).toBeEnabled();
    expect(document.body.textContent).toContain('实际检查 1已通过');
  });

  it('AC-AUD-004.2/003.1/003.3: invalid range preserves the previous request and a named task timeline clears every other filter', async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(`${base}/api/system/audit`, ({ request }) => {
        const query = new URL(request.url).searchParams;
        queries.push(query);
        return HttpResponse.json({
          items: [
            {
              seq: 91,
              at: '2026-10-05T10:00:00Z',
              category: 'sandbox',
              type: 'sandbox.state.changed',
              severity: 'warn',
              actor: 'system',
              summary: '任务等待输入',
              subjectType: 'sandbox',
              subjectId: 'task-actual',
              detail: { sandboxName: '整理真实接口', status: 'waiting_input' },
            },
          ],
          hasMore: false,
        } satisfies AuditListDto);
      }),
      http.get(`${base}/api/sandboxes/task-actual`, () =>
        HttpResponse.json({ id: 'task-actual', name: '整理真实接口' }),
      ),
    );
    mount(<AuditStreamContainer />);
    await screen.findByTestId('audit-row-91');
    fireEvent.change(screen.getByRole('combobox', { name: '类别' }), {
      target: { value: 'sandbox' },
    });
    fireEvent.click(screen.getByRole('switch', { name: '仅告警' }));
    fireEvent.change(screen.getByLabelText('起始时间'), { target: { value: '2026-10-05T10:00' } });
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-10-05T12:00' } });
    await waitFor(() => {
      expect(queries.at(-1)?.get('to')).not.toBeNull();
    });
    const count = queries.length;
    const end = screen.getByLabelText('结束时间');
    fireEvent.change(end, { target: { value: '2026-10-05T09:00' } });
    expect(end).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('下面仍是上一次的筛选结果');
    expect(queries).toHaveLength(count);
    fireEvent.click(
      within(screen.getByTestId('audit-row-91')).getByRole('button', {
        name: '查看该任务完整时间线',
      }),
    );
    await screen.findByText('任务：整理真实接口');
    await waitFor(() => {
      expect(queries.at(-1)?.get('subjectId')).toBe('task-actual');
    });
    expect(queries.at(-1)?.has('category')).toBe(false);
    expect(queries.at(-1)?.has('severity')).toBe(false);
    expect(queries.at(-1)?.has('from')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '清除任务筛选' }));
    expect(screen.getByRole('combobox', { name: '类别' })).toHaveFocus();
  });
});
