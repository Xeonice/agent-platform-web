// 审计面板集成测试（F21-5 §7.3 + §9.2 VS-3）：vitest + jsdom + MSW node server
//（`onUnhandledRequest: 'error'` ⇒ 路径拼错会当场红，不会静默通过）。
//
// ⭐ 两条**证伪用例**在本文件里，它们针对的两个错误都属于"改完页面看起来完全正常、
//    其余用例照旧全绿"的形态，只有它们会红：
//    · 给 `useInfiniteQuery` 加 `refetchInterval` ⇒「推进 30s 只发 1 个 since、0 个 before」红
//    · 把 `isError` 窄化掉        ⇒「500 时『暂无记录』不得存在」这条**否定断言**红
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { AuditStreamContainer } from '@/containers/system/AuditStreamContainer';
import type { AuditEventDto, AuditListDto } from '@/types/audit';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

let requests: URLSearchParams[] = [];

function ev(seq: number, overrides: Partial<AuditEventDto> = {}): AuditEventDto {
  return {
    seq,
    at: new Date(2026, 7, 26, 10, 0, 0, seq % 1000).toISOString(),
    category: 'sandbox',
    type: 'sandbox.provision.stage',
    severity: 'info',
    actor: 'system',
    summary: `事件 ${String(seq)}`,
    ...overrides,
  };
}

/**
 * 替身**在服务端一侧**实现 `severity` 并集过滤（后端是 `WHERE severity IN (...)`）。
 *
 * ⚠️ 不实现它的替身会让「仅告警」这一整档失去意义：客户端不再裁之后，
 * 一个恒返回全部严重度的替身等于在测试里断言"筛选没生效也算对"。
 */
function bySeverity(query: URLSearchParams, items: AuditEventDto[]): AuditEventDto[] {
  const raw = query.get('severity');
  if (raw === null) return items;
  const wanted = raw.split(',');
  return items.filter((e) => wanted.includes(e.severity));
}

function serve(respond: (query: URLSearchParams) => AuditListDto | Response): void {
  server.use(
    http.get(`${API_BASE}/api/system/audit`, ({ request }) => {
      const query = new URL(request.url).searchParams;
      requests.push(query);
      const result = respond(query);
      return result instanceof Response ? result : HttpResponse.json(result);
    }),
  );
}

function renderPanel(): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<AuditStreamContainer />, { wrapper: Wrapper });
}

function seqsOnScreen(): number[] {
  return screen
    .getAllByTestId(/^audit-row-/)
    .map((el) => Number(el.getAttribute('data-testid')?.replace('audit-row-', '')));
}

beforeEach(() => {
  cleanup();
  requests = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('VS-3 步 1–2 · 首屏与向下滚都走 seq 游标', () => {
  it('首屏请求**不带** since / before；列表按 seq 降序', async () => {
    serve((q) =>
      q.has('since')
        ? { items: [], hasMore: false }
        : { items: [ev(100), ev(99), ev(98)], hasMore: false },
    );

    renderPanel();
    await waitFor(() => {
      expect(seqsOnScreen()).toEqual([100, 99, 98]);
    });
    const first = requests[0];
    expect(first?.has('since')).toBe(false);
    expect(first?.has('before')).toBe(false);
    // VS-3 步 1「默认最近 200 条」：limit 是**面板的默认**，不是 service 的私事——
    // 谁把 AUDIT_PAGE_LIMIT 调小，首屏就悄悄只剩几十条，而列表看起来毫无异样。
    expect(first?.get('limit')).toBe('200');
  });

  it('滚到底 ⇒ 请求带 `before=<当前最老 seq>`，**不带 offset/page**', async () => {
    serve((q) => {
      if (q.has('since')) return { items: [], hasMore: false };
      const before = q.get('before');
      return before === null
        ? { items: [ev(100), ev(99)], hasMore: true }
        : { items: [ev(98), ev(97)], hasMore: false };
    });

    renderPanel();
    await screen.findByText('事件 100');
    fireEvent.click(screen.getByRole('button', { name: '加载更早的记录' }));

    await waitFor(() => {
      expect(seqsOnScreen()).toEqual([100, 99, 98, 97]);
    });
    expect(requests.find((q) => q.has('before'))?.get('before')).toBe('99');
    expect(requests.some((q) => q.has('offset') || q.has('page'))).toBe(false);
    // 已到最早 ⇒ 「已到最早记录」，不再挂一个转不完的 spinner。
    expect(screen.getByText('已到最早记录')).toBeInTheDocument();
  });
});

describe('VS-3 步 3 · 增量刷新', () => {
  it('新事件 prepend 到顶部：总数正确、无重复 seq、顺序仍降序', async () => {
    let sinceCalls = 0;
    serve((q) => {
      if (q.has('since')) {
        sinceCalls += 1;
        return sinceCalls === 1
          ? { items: [ev(103), ev(102), ev(101)], hasMore: false }
          : { items: [], hasMore: false };
      }
      return { items: [ev(100), ev(99), ev(98)], hasMore: false };
    });

    renderPanel();
    await waitFor(() => {
      expect(seqsOnScreen()).toEqual([103, 102, 101, 100, 99, 98]);
    });
    expect(new Set(seqsOnScreen()).size).toBe(6);
  });

  it('首屏 20 条 → 推进 30s 返回 3 条更新的 ⇒ prepend 到顶部、总数 23、无重复、仍降序', async () => {
    // ⚠️ 与上一条的区别：上一条测的是**挂载那一次**增量；这条测的是**轮询回来**的那一次。
    // 只测前者的话，`refetchInterval` 拿回来的批次有没有真的 prepend 进第一页无人验证
    // ——那正是"页面看着在动、其实只有第一次动过"的形态。
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const firstScreen = Array.from({ length: 20 }, (_, i) => ev(100 - i));
    let sinceCalls = 0;
    serve((q) => {
      if (q.has('since')) {
        sinceCalls += 1;
        return sinceCalls === 1
          ? { items: [], hasMore: false }
          : { items: [ev(103), ev(102), ev(101)], hasMore: false };
      }
      return { items: firstScreen, hasMore: false };
    });

    renderPanel();
    await waitFor(() => {
      expect(seqsOnScreen()).toHaveLength(20);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    await waitFor(() => {
      expect(seqsOnScreen()).toHaveLength(23);
    });
    const seqs = seqsOnScreen();
    expect(seqs.slice(0, 3)).toEqual([103, 102, 101]);
    expect(new Set(seqs).size).toBe(23);
    expect([...seqs].sort((a, b) => b - a)).toEqual(seqs);
  });

  it('⭐ 推进 30s ⇒ **只发 1 个 `since` 请求、0 个 `before` 请求**（已加载的 3 页不被重拉）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve((q) => {
      if (q.has('since')) return { items: [], hasMore: false };
      const before = q.get('before');
      if (before === null) return { items: [ev(100), ev(99)], hasMore: true };
      if (before === '99') return { items: [ev(98), ev(97)], hasMore: true };
      return { items: [ev(96), ev(95)], hasMore: false };
    });

    renderPanel();
    await screen.findByText('事件 100');
    // 滚到第 3 页：此时历史方向已经发过 3 个请求（首屏 + 两页 before）。
    fireEvent.click(screen.getByRole('button', { name: '加载更早的记录' }));
    await screen.findByText('事件 98');
    fireEvent.click(screen.getByRole('button', { name: '加载更早的记录' }));
    await screen.findByText('事件 96');
    expect(requests.filter((q) => q.has('before'))).toHaveLength(2);

    requests = [];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    // 增量方向是**独立的一条轻量 query**：一个 since 请求。
    expect(requests.filter((q) => q.has('since'))).toHaveLength(1);
    // ⛔ 给 useInfiniteQuery 加 refetchInterval 的话，这里会是 3（已加载的三页被整个重拉，
    //    返回内容与缓存逐字节相同）。页面表现毫无异常，只有这条断言会红。
    expect(requests.filter((q) => q.has('before'))).toHaveLength(0);
  });
});

describe('VS-3 步 4 · 切筛选靠 query key 重置游标', () => {
  it('翻到第 2 页后切「仅告警」⇒ 新请求**不带旧 before**、**带 severity=warn,error**，列表从头渲染', async () => {
    serve((q) => {
      if (q.has('since')) return { items: [], hasMore: false };
      const before = q.get('before');
      const page =
        before === null
          ? [ev(100, { severity: 'error' }), ev(99), ev(98, { severity: 'warn' })]
          : [ev(97), ev(96, { severity: 'warn' })];
      return { items: bySeverity(q, page), hasMore: before === null };
    });

    renderPanel();
    await screen.findByText('事件 100');
    fireEvent.click(screen.getByRole('button', { name: '加载更早的记录' }));
    await screen.findByText('事件 97');
    expect(requests.some((q) => q.get('before') === '98')).toBe(true);

    requests = [];
    fireEvent.click(screen.getByLabelText('仅告警'));

    await waitFor(() => {
      expect(seqsOnScreen()).toEqual([100, 98]);
    });
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((q) => !q.has('before'))).toBe(true);
    // ⭐ 筛选**发生在服务端**：请求必须带上并集。退回客户端裁的那一版这里是空的，
    //    而列表长得一模一样——代价要等到"最近 200 条全是 info"那天才显形。
    const withSeverity = requests.filter((q) => q.has('severity'));
    expect(withSeverity.length).toBeGreaterThan(0);
    expect(withSeverity.every((q) => q.get('severity') === 'warn,error')).toBe(true);
  });

  it('「仅告警」筛完为空 ⇒ 是**服务端**说没有（空态诚实），而不是本地裁没了', async () => {
    // ⚠️ 服务端过滤之后，「空 + `hasMore:false`」才真的等于「全表没有这一档」：
    //    后端 `hasMore = rows.length > limit`（audit.repository.ts），空页恒 `hasMore:false`
    //    ⇒ 空态背后不会藏着一个够得着却没给的「加载更早的记录」。
    //    客户端裁的那一版正相反：它拉的是**全部严重度**的最近一页，裁完为空时
    //    更老的告警仍在表里，而 UI 说的是"无匹配"。
    serve((q) => {
      if (q.has('since')) return { items: [], hasMore: false };
      const page = [ev(100), ev(99), ev(98)];
      const items = bySeverity(q, page);
      return { items, hasMore: items.length > 200 };
    });

    renderPanel();
    await screen.findByText('事件 100');
    requests = [];
    fireEvent.click(screen.getByLabelText('仅告警'));

    await screen.findByText('当前筛选无匹配记录');
    // 空是服务端筛出来的：请求确实带了并集，且没有"还有更早"这个悬而未决的入口。
    expect(requests.some((q) => q.get('severity') === 'warn,error')).toBe(true);
    expect(screen.queryByRole('button', { name: '加载更早的记录' })).toBeNull();
  });
});

describe('VS-3 失败路径 · 断层如实告知', () => {
  it('since 拉满 limit + hasMore ⇒ 断层提示夹在两段之间，且**未自动继续拉取**', async () => {
    let sinceCalls = 0;
    serve((q) => {
      if (q.has('since')) {
        sinceCalls += 1;
        return sinceCalls === 1
          ? { items: [ev(400), ev(399)], hasMore: true }
          : { items: [], hasMore: false };
      }
      return { items: [ev(100), ev(99)], hasMore: false };
    });

    renderPanel();
    const notice = await screen.findByTestId('audit-gap-notice');
    expect(notice).toHaveTextContent('此处有未加载的事件');

    // 位置：夹在新批（400/399）与旧段（100/99）之间。
    const items = [...(notice.parentElement?.children ?? [])].map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(items).toEqual([
      'audit-row-400',
      'audit-row-399',
      'audit-gap-notice',
      'audit-row-100',
      'audit-row-99',
    ]);
    // 首屏 1 + 增量 1 = 2。自动追平会让这个数字继续涨。
    expect(requests).toHaveLength(2);
  });

  it('点 [加载中间部分] ⇒ 只填一段（发一个 before 请求，洞收窄后停住）', async () => {
    let sinceCalls = 0;
    serve((q) => {
      if (q.has('since')) {
        sinceCalls += 1;
        return sinceCalls === 1
          ? { items: [ev(400), ev(399)], hasMore: true }
          : { items: [], hasMore: false };
      }
      const before = q.get('before');
      if (before === '399') return { items: [ev(398), ev(300)], hasMore: true };
      return { items: [ev(100), ev(99)], hasMore: false };
    });

    renderPanel();
    await screen.findByTestId('audit-gap-notice');

    requests = [];
    fireEvent.click(screen.getByRole('button', { name: '加载中间部分' }));

    await waitFor(() => {
      expect(seqsOnScreen()).toEqual([400, 399, 398, 300, 100, 99]);
    });
    expect(requests.filter((q) => q.has('before'))).toHaveLength(1);
    // 洞还在（收窄到 100–300），提示仍在——**不假装已经填完**。
    expect(screen.getByTestId('audit-gap-notice')).toBeInTheDocument();
  });
});

describe('VS-3 失败路径 · 失败不许伪装成空', () => {
  it('⭐ 500 ⇒ 「审计流加载失败 [重试]」，且**「暂无记录」文案不存在**', async () => {
    serve(() => new HttpResponse(null, { status: 500 }));

    renderPanel();
    await screen.findByText('❌ 审计流加载失败');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    // ⛔ 否定断言是关键：把 isError 窄化掉之后，UI 会平静地显示「暂无记录」，
    //    所有肯定断言都还是绿的，只有这一条会红。
    expect(screen.queryByText('暂无记录')).not.toBeInTheDocument();
    expect(screen.queryByText('当前筛选无匹配记录')).not.toBeInTheDocument();
    expect(screen.queryByText('该类事件平台尚未记录')).not.toBeInTheDocument();
  });

  it('[重试] 能把列表拉回来（失败态不是死胡同）', async () => {
    let failed = false;
    serve((q) => {
      if (q.has('since')) return { items: [], hasMore: false };
      if (!failed) {
        failed = true;
        return new HttpResponse(null, { status: 500 });
      }
      return { items: [ev(100)], hasMore: false };
    });

    renderPanel();
    await screen.findByText('❌ 审计流加载失败');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('事件 100')).toBeInTheDocument();
  });

  it('真的没有记录 ⇒ 「暂无记录」+ 当前筛选说明（不是空白，也不是失败）', async () => {
    serve(() => ({ items: [], hasMore: false }));

    renderPanel();
    expect(await screen.findByText('暂无记录')).toBeInTheDocument();
    expect(screen.getByText(/当前无筛选条件/)).toBeInTheDocument();
    expect(screen.queryByText('❌ 审计流加载失败')).not.toBeInTheDocument();
    // 三态互相可区分：新加的「尚未记录」不许把这一档盖掉。
    expect(screen.queryByText('该类事件平台尚未记录')).not.toBeInTheDocument();
    // ⛔ 真·无记录**没有** [清除筛选]：没有筛选可清，给了反而暗示"是你自己筛掉的"。
    expect(screen.queryByRole('button', { name: '清除筛选' })).not.toBeInTheDocument();
  });

  /**
   * ★ 第三个空态「该类事件平台尚未记录」**在容器级当前没有真实实例**，这条守的是它的反面。
   *
   * 缘由：契约给五个类别，而后端"今天写不写"是另一回事。2026-08-28 之前 `image` / `system`
   * 一条都不写，选中「镜像」得到「当前筛选无匹配记录」时用户读出来的是"镜像相关操作从来没
   * 发生过"，于是他会去调严重度、调时间范围——而调到天荒地老也不会有记录。那天后端补齐了
   * 镜像/系统两档的写入点，`AUDIT_CATEGORY_EMIT_STATUS` 随之全标 `emitted`，
   * **于是"镜像筛空"的正确答案从「尚未记录」变成了「当前筛选无匹配记录」**。
   *
   * ⚠️ 这不是"把用例改绿"：它是同一条纪律的另一侧——「这个类别最近没事发生」不许被冤成
   * 「平台没记过这类事件」。表哪天再标回 `not-yet-emitted`（后端撤回写入点），这条会红，
   * 逼着一起想清楚空态该说什么。
   *
   * 第三档今天由谁看着：
   *   · 分支逻辑 → `lib/audit/__tests__/auditStream.test.ts`（显式传一张"假设某类还没落地"的表）；
   *   · 那句文案怎么渲染 → `AuditStreamCard.view.stories.tsx` 的 `EmptyCategoryNotYetEmitted`（props 驱动）；
   *   · 表 ↔ 替身是否还对得上 → `mocks/handlers.test.ts` 的双向对账守卫。
   * ⛔ 容器这一层**不许**为了凑覆盖去 mock 掉 `auditEmptyKind`——那样测的就只是 mock 自己。
   */
  it('⭐ 后端在写的类别（镜像 / 凭证）筛空 ⇒ 「当前筛选无匹配记录」，**不许**被「尚未记录」盖掉', async () => {
    serve((q) => {
      if (q.has('since')) return { items: [], hasMore: false };
      // 替身照真后端来：这两个类别后端都在写，只是当前条件恰好筛不到。
      const picked = q.get('category');
      const items = picked === 'image' || picked === 'credential' ? [] : [ev(100)];
      return { items, hasMore: false };
    });

    renderPanel();
    await screen.findByText('事件 100');
    fireEvent.change(screen.getByLabelText('类别'), { target: { value: 'image' } });

    expect(await screen.findByText('当前筛选无匹配记录')).toBeInTheDocument();
    // 空态必须说清筛的是什么（否则用户以为平台什么都没干过）。
    expect(screen.getByText('类别：镜像')).toBeInTheDocument();
    // ⛔ 否定断言是关键：两句话同时渲染出来时，肯定断言照样绿。
    expect(screen.queryByText('该类事件平台尚未记录')).not.toBeInTheDocument();
    expect(screen.queryByText('暂无记录')).not.toBeInTheDocument();
    // 请求照旧发出去（⛔ 不许"知道后端不写"就跳过请求——那会在后端补上写入点当天变成空白页；
    // 镜像这一档恰好就是那天，跳过请求的那一版会给出一个永远空白、且没有任何东西会红的页面）。
    expect(requests.some((q) => q.get('category') === 'image')).toBe(true);
    // 出路还在。
    expect(screen.getByRole('button', { name: '清除筛选' })).toBeInTheDocument();

    // ⭐ 换到另一个后端在写的类别、同样筛空 ⇒ 结论一致。这一半守的是反向漂移：
    //    把文案写成"只要挑了类别就说尚未记录"的那一版，一次真实的"这个类别最近没事发生"
    //    会被冤成"平台没记过凭证事件"。
    fireEvent.change(screen.getByLabelText('类别'), { target: { value: 'credential' } });
    // ⚠️ 先等筛选说明换过来：两次的主句是同一句，只断言主句的话，这一半在"切换根本没生效"
    //    时也会绿（上一次的空态还挂在屏幕上）。
    expect(await screen.findByText('类别：凭证')).toBeInTheDocument();
    expect(screen.getByText('当前筛选无匹配记录')).toBeInTheDocument();
    expect(screen.queryByText('该类事件平台尚未记录')).not.toBeInTheDocument();
  });

  it('筛掉之后没结果 ⇒ 「当前筛选无匹配记录 [清除筛选]」，与「暂无记录」**不同文案**', async () => {
    serve((q) =>
      q.has('since')
        ? { items: [], hasMore: false }
        : { items: bySeverity(q, [ev(100)]), hasMore: false },
    );

    renderPanel();
    await screen.findByText('事件 100');
    fireEvent.click(screen.getByLabelText('仅告警'));

    expect(await screen.findByText('当前筛选无匹配记录')).toBeInTheDocument();
    expect(screen.queryByText('暂无记录')).not.toBeInTheDocument();
    expect(screen.queryByText('该类事件平台尚未记录')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(await screen.findByText('事件 100')).toBeInTheDocument();
  });
});

describe('§3A ⑦ · 增量轮询挂了要说出来，但不许盖住列表', () => {
  it('⭐ 首屏成功 + 增量 500 ⇒ 顶部一行「实时更新已中断」，**列表仍在**、也没有整块失败态', async () => {
    // ⚠️ 这是 ⑥「失败伪装成空」的同一个谎换了个时间点：用户打开面板、首屏成功，
    //    随后审计接口挂了、轮询一直 500 —— 屏幕上没有任何变化，只是新事件不再出现。
    //    而异常风暴时审计接口最可能挂，那恰恰是用户最需要知道"我看到的不是全部"的时刻。
    serve((q) =>
      q.has('since')
        ? new HttpResponse(null, { status: 500 })
        : { items: [ev(100), ev(99)], hasMore: false },
    );

    renderPanel();
    expect(await screen.findByTestId('audit-live-update-error')).toHaveTextContent(
      '实时更新已中断',
    );
    // ⛔ 否定断言是关键：用整块错误态盖住列表的那一版，前一条肯定断言照样绿。
    expect(seqsOnScreen()).toEqual([100, 99]);
    expect(screen.queryByText('❌ 审计流加载失败')).not.toBeInTheDocument();
  });

  it('增量好着的时候**不许**挂这一行（提示只在真中断时出现）', async () => {
    serve((q) =>
      q.has('since') ? { items: [], hasMore: false } : { items: [ev(100)], hasMore: false },
    );

    renderPanel();
    await screen.findByText('事件 100');
    expect(screen.queryByTestId('audit-live-update-error')).not.toBeInTheDocument();
  });

  it('历史方向本身就挂了 ⇒ 只说一次（整块失败态里不再叠一行「实时更新已中断」）', async () => {
    serve(() => new HttpResponse(null, { status: 500 }));

    renderPanel();
    await screen.findByText('❌ 审计流加载失败');
    expect(screen.queryByTestId('audit-live-update-error')).not.toBeInTheDocument();
  });
});

describe('VS-3 步 5–6 · detail 行内展开与沙箱时间线', () => {
  it('点行 ⇒ detail 在**行内**展开（父节点是列表行，不是 dialog）', async () => {
    serve((q) =>
      q.has('since')
        ? { items: [], hasMore: false }
        : {
            items: [ev(100, { subjectType: 'sandbox', subjectId: 'sb-1', detail: { a: 1 } })],
            hasMore: false,
          },
    );

    renderPanel();
    const row = await screen.findByTestId('audit-row-100');
    fireEvent.click(within(row).getByRole('button', { expanded: false }));

    const panel = await screen.findByTestId('audit-detail-panel');
    expect(panel.closest('li')).toBe(row);
    expect(panel.closest('[role="dialog"]')).toBeNull();
  });

  it('无 detail 的行**没有展开箭头**（判据是 model 不产出 detailText）', async () => {
    serve((q) =>
      q.has('since') ? { items: [], hasMore: false } : { items: [ev(100)], hasMore: false },
    );

    renderPanel();
    const row = await screen.findByTestId('audit-row-100');
    expect(within(row).queryByRole('button', { expanded: false })).toBeNull();
  });

  it('[查看该沙箱完整时间线] ⇒ 同一个 hook，列表只剩该 subjectId 的事件', async () => {
    serve((q) => {
      if (q.has('since')) return { items: [], hasMore: false };
      const subject = q.get('subjectId');
      if (subject === 'sb-1') {
        return { items: [ev(100, { subjectType: 'sandbox', subjectId: 'sb-1' })], hasMore: false };
      }
      return {
        items: [
          ev(100, { subjectType: 'sandbox', subjectId: 'sb-1' }),
          ev(99, { subjectType: 'sandbox', subjectId: 'sb-2' }),
        ],
        hasMore: false,
      };
    });

    renderPanel();
    const row = await screen.findByTestId('audit-row-100');
    fireEvent.click(within(row).getByRole('button', { name: '查看该沙箱完整时间线' }));

    await waitFor(() => {
      expect(seqsOnScreen()).toEqual([100]);
    });
    expect(requests.some((q) => q.get('subjectId') === 'sb-1')).toBe(true);
  });
});

describe('加载态', () => {
  it('加载中是**骨架行 × 5**，不是整块 spinner（避免筛选切换时页面跳动）', async () => {
    serve(() => ({ items: [], hasMore: false }));
    renderPanel();
    expect(screen.getAllByTestId('audit-skeleton-row')).toHaveLength(5);
    await screen.findByText('暂无记录');
  });
});
