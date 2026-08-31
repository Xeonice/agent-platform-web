// 已保留卷集成（container + msw）：F21-6 §3.3 三条硬规格从外部钉一遍。
//  ① 两个大小都在（10 §6：只显示一个必然误导，实测差 70 倍）；
//  ② [下载] 是 `<a href download>`，**渲染与点击都不发 fetch**（浏览器原生下载栏）；
//  ③ 没有「恢复」入口（P20 §6：语义未裁，连禁用态都不摆）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { RetainedVolumesContainer } from '@/containers/project/RetainedVolumesContainer';

const BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const MB = 1024 * 1024;
const GB = 1024 * MB;

function wrap(node: ReactNode): ReactNode {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

/** 一条真实比例的记录：磁盘 1.0 GB / tar 14 MB（实测值，见 10 §6「保留卷的打包口径」）。 */
function oneVolume(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'rv-1',
    projectId: 'proj-A',
    sandboxId: 'sbx-7f3a',
    source: 'manual-destroy',
    retainedAt: '2026-08-25T10:12:00.000Z',
    retainUntil: '2099-01-01T00:00:00.000Z',
    diskBytes: GB,
    downloadBytes: 14 * MB,
    ...overrides,
  };
}

function serveList(items: unknown[]): void {
  server.use(http.get(`${BASE}/api/retained-volumes`, () => HttpResponse.json(items)));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('RetainedVolumesContainer', () => {
  it('⭐ 一行里两个大小都出现，且各是各的数（差 70 倍，只给一个必然误导）', async () => {
    serveList([oneVolume()]);
    render(wrap(<RetainedVolumesContainer projectId="proj-A" projectName="acme-web" />));

    const sizes = await screen.findByTestId('retained-volume-sizes');
    expect(sizes).toHaveTextContent('占用 1.0 GB');
    expect(sizes).toHaveTextContent('下载 14 MB');
  });

  it('⭐ [下载] 是 `<a href download>` 指向 /:id/archive —— 不是按钮', async () => {
    serveList([oneVolume()]);
    render(wrap(<RetainedVolumesContainer projectId="proj-A" projectName="acme-web" />));

    const link = await screen.findByTestId('retained-volume-download');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', `${BASE}/api/retained-volumes/rv-1/archive`);
    expect(link).toHaveAttribute('download');
  });

  it('⭐ 渲染下载入口的整个过程中一次 fetch 都不为它发生（不接管流）', async () => {
    serveList([oneVolume()]);
    render(wrap(<RetainedVolumesContainer projectId="proj-A" projectName="acme-web" />));
    await screen.findByTestId('retained-volume-download');

    // jsdom 不实现真实导航，点原生锚点会往 stderr 吐 "Not implemented: navigation"。
    // 拦掉默认行为只是消噪 —— 被断言的是**点击处理链里有没有人去 fetch**，与导航无关。
    const swallow = (e: Event): void => {
      e.preventDefault();
    };
    document.addEventListener('click', swallow);
    try {
      // 列表已经拉完了，此后为「下载」再发的任何请求都是"把流读进内存"的实现。
      const spy = vi.spyOn(globalThis, 'fetch');
      fireEvent.click(screen.getByTestId('retained-volume-download'));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('click', swallow);
    }
  });

  it('⭐ 否定性：面板里没有「恢复」（P20 §6 本轮不做，禁用态也不摆）', async () => {
    serveList([oneVolume()]);
    render(wrap(<RetainedVolumesContainer projectId="proj-A" projectName="acme-web" />));
    await screen.findByTestId('retained-volume-row');

    expect(screen.queryByText(/恢复/)).toBeNull();
    expect(screen.queryByRole('button', { name: /恢复/ })).toBeNull();
  });

  it('删除要二次确认，确认后打 DELETE /:id 并从列表消失', async () => {
    let deleted: string | undefined;
    let listCalls = 0;
    server.use(
      http.get(`${BASE}/api/retained-volumes`, () => {
        listCalls += 1;
        return HttpResponse.json(listCalls === 1 ? [oneVolume()] : []);
      }),
      http.delete(`${BASE}/api/retained-volumes/:id`, ({ params }) => {
        deleted = String(params['id']);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(wrap(<RetainedVolumesContainer projectId="proj-A" projectName="acme-web" />));
    await screen.findByTestId('retained-volume-row');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    // 第一下只展开确认，不发请求。
    expect(deleted).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => {
      expect(deleted).toBe('rv-1');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('retained-volume-row')).toBeNull();
    });
    expect(screen.getByTestId('retained-volumes-empty')).toBeInTheDocument();
  });

  it('空态说清"卷是怎么来的"，且不出现合计行', async () => {
    serveList([]);
    render(wrap(<RetainedVolumesContainer projectId="proj-A" projectName="acme-web" />));

    const empty = await screen.findByTestId('retained-volumes-empty');
    expect(empty).toHaveTextContent('这个项目还没有已保留卷。');
    expect(empty).toHaveTextContent('保留工作区卷');
    expect(screen.queryByTestId('retained-volumes-totals')).toBeNull();
  });

  it('⭐ 列表失败 ≠ 空态：给红字，不说"还没有已保留卷"', async () => {
    server.use(
      http.get(`${BASE}/api/retained-volumes`, () =>
        HttpResponse.json(
          { code: 'INTERNAL', message: '读取保留卷失败', retryable: true },
          { status: 500 },
        ),
      ),
    );
    render(wrap(<RetainedVolumesContainer projectId="proj-A" projectName="acme-web" />));

    expect(await screen.findByRole('alert')).toHaveTextContent('读取保留卷失败');
    expect(screen.queryByTestId('retained-volumes-empty')).toBeNull();
  });

  it('多条按 retainUntil 升序：最先被清掉的排最上面（界面顺序 = 消失顺序）', async () => {
    serveList([
      oneVolume({ id: 'rv-late', retainUntil: '2099-12-01T00:00:00.000Z' }),
      oneVolume({ id: 'rv-soon', retainUntil: '2099-01-01T00:00:00.000Z' }),
    ]);
    render(wrap(<RetainedVolumesContainer projectId="proj-A" projectName="acme-web" />));

    await waitFor(() => {
      expect(screen.getAllByTestId('retained-volume-download')).toHaveLength(2);
    });
    const hrefs = screen
      .getAllByTestId('retained-volume-download')
      .map((el) => el.getAttribute('href'));
    expect(hrefs[0]).toContain('rv-soon');
    expect(hrefs[1]).toContain('rv-late');
  });

  it('sandbox 已归档（弱引用断掉）→ 那条仍可下载与删除，不是坏行', async () => {
    serveList([oneVolume({ sandboxId: undefined })]);
    render(wrap(<RetainedVolumesContainer projectId="proj-A" projectName="acme-web" />));

    expect(await screen.findByText('来源任务已归档')).toBeInTheDocument();
    expect(screen.getByTestId('retained-volume-download')).toHaveAttribute('href');
    expect(screen.getByRole('button', { name: '删除' })).toBeEnabled();
  });
});
