// `hooks/system/useAuditStream.ts` 单测（F21-5 §7.1 ①–⑤）。vitest + jsdom + MSW node server
//（`onUnhandledRequest: 'error'` ⇒ 路径拼错会当场红）。
//
// 这五条针对的都是"改完页面看起来完全正常"的错误：断层被吃掉、两个方向合并后乱序、
// 切筛选带着旧游标、失败态被压成空态、增量游标取错端。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { useAuditStream } from '@/hooks/system/useAuditStream';
import type { AuditEventDto, AuditFilters, AuditListDto } from '@/types/audit';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

let requests: URLSearchParams[] = [];

function ev(seq: number, severity: AuditEventDto['severity'] = 'info'): AuditEventDto {
  return {
    seq,
    at: new Date(2026, 7, 26, 10, 0, 0, seq % 1000).toISOString(),
    category: 'system',
    type: 'system.something',
    severity,
    actor: 'system',
    summary: `事件 ${String(seq)}`,
  };
}

/** 按 query 定制响应；同时记录**发出去的每一个请求**（断言"发了什么"，不只是"回了什么"）。 */
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

function renderStream(initialFilters: AuditFilters = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return renderHook(({ filters }: { filters: AuditFilters }) => useAuditStream(filters), {
    wrapper: Wrapper,
    initialProps: { filters: initialFilters },
  });
}

beforeEach(() => {
  cleanup();
  requests = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('① 断层检测：since 方向的 hasMore 就是"有断层"', () => {
  it('增量拉满 limit（hasMore: true）⇒ 产出 gap {afterSeq, beforeSeq}', async () => {
    serve((q) =>
      q.has('since')
        ? { items: [ev(400), ev(399), ev(398)], hasMore: true }
        : { items: [ev(100), ev(99)], hasMore: false },
    );

    const { result } = renderStream();
    await waitFor(() => {
      expect(result.current.gap).not.toBeNull();
    });
    expect(result.current.gap).toEqual({ afterSeq: 100, beforeSeq: 398 });
  });

  it('hasMore: false ⇒ gap 恒为 null（哪怕 seq 之间有跳号）', async () => {
    // ⚠️ 增量批次刻意与已见位置**不连号**（100 → 102 之间空了 101）：
    // 若批次首尾相接，连续性判定会替 `hasMore` 返回 null，这条用例就测不到 hasMore 那一支。
    serve((q) =>
      q.has('since')
        ? { items: [ev(150), ev(102)], hasMore: false }
        : { items: [ev(100), ev(99)], hasMore: false },
    );

    const { result } = renderStream();
    await waitFor(() => {
      expect(result.current.rows.map((r) => r.seq)).toContain(102);
    });
    expect(result.current.gap).toBeNull();
  });

  it('⛔ 检测到断层后**不自动接着拉**（否则异常风暴下是无界请求）', async () => {
    serve((q) =>
      q.has('since')
        ? { items: [ev(400), ev(399), ev(398)], hasMore: true }
        : { items: [ev(100)], hasMore: false },
    );

    const { result } = renderStream();
    await waitFor(() => {
      expect(result.current.gap).not.toBeNull();
    });
    // 首屏 1 个 + 增量 1 个 = 2；多出来的任何一个都说明有人写了自动追平。
    expect(requests).toHaveLength(2);
  });
});

describe('② 合并后仍按 seq 降序，且无重复 seq', () => {
  it('prepend 的增量与已有 append 段交错时顺序正确', async () => {
    serve((q) =>
      q.has('since')
        ? { items: [ev(102), ev(101), ev(100)], hasMore: false }
        : { items: [ev(100), ev(99), ev(98)], hasMore: false },
    );

    const { result } = renderStream();
    await waitFor(() => {
      expect(result.current.rows).toHaveLength(5);
    });
    expect(result.current.rows.map((r) => r.seq)).toEqual([102, 101, 100, 99, 98]);
  });

  it('向下滚一页后，历史段 append 在尾部且整体仍降序', async () => {
    serve((q) => {
      if (q.has('since')) return { items: [], hasMore: false };
      const before = q.get('before');
      return before === null
        ? { items: [ev(100), ev(99)], hasMore: true }
        : { items: [ev(98), ev(97)], hasMore: false };
    });

    const { result } = renderStream();
    await waitFor(() => {
      expect(result.current.hasOlder).toBe(true);
    });
    act(() => {
      result.current.fetchOlder();
    });
    await waitFor(() => {
      expect(result.current.rows).toHaveLength(4);
    });
    expect(result.current.rows.map((r) => r.seq)).toEqual([100, 99, 98, 97]);
    // 向下滚用的是 seq 游标，**不是 offset**（offset 在 append-only 流上会重复显示）。
    const older = requests.filter((q) => q.has('before'));
    expect(older[0]?.get('before')).toBe('99');
    expect(requests.some((q) => q.has('offset') || q.has('page'))).toBe(false);
  });
});

describe('③ filters 变化 ⇒ query key 变化 ⇒ 游标天然重置', () => {
  it('已经翻到第 2 页后切筛选，新请求**不带旧 before**', async () => {
    serve((q) => {
      if (q.has('since')) return { items: [], hasMore: false };
      const before = q.get('before');
      return before === null
        ? { items: [ev(100), ev(99)], hasMore: true }
        : { items: [ev(98), ev(97)], hasMore: true };
    });

    const { result, rerender } = renderStream();
    await waitFor(() => {
      expect(result.current.hasOlder).toBe(true);
    });
    act(() => {
      result.current.fetchOlder();
    });
    await waitFor(() => {
      expect(result.current.rows).toHaveLength(4);
    });
    expect(requests.some((q) => q.get('before') === '99')).toBe(true);

    requests = [];
    rerender({ filters: { category: 'sandbox' } });

    await waitFor(() => {
      expect(requests.some((q) => q.get('category') === 'sandbox')).toBe(true);
    });
    const afterSwitch = requests.filter((q) => q.get('category') === 'sandbox');
    expect(afterSwitch.every((q) => !q.has('before'))).toBe(true);
  });

  it('⭐ 切筛选 ⇒ **`gap` 也清掉**（旧洞属于另一条流，在新流里根本不存在）', async () => {
    // ⚠️ 上一条只断言了"新请求不带旧 before"，`gap` 是不是 null 它一个字都没说
    // ——那个缺口正是这个 bug 从头到尾没被任何用例碰到的原因（§3A ④ 已订正）。
    // 现场：全部类别下增量拉满产出洞 → 切「类别=凭证」→ 洞原样保留 ⇒
    // 在凭证列表中间渲染出一个这里根本不存在的「此处有未加载的事件」，
    // 点 [加载中间部分] 还会把一整页凭证历史 prepend 进去、再生成一个同样虚构的洞。
    serve((q) => {
      // 「凭证」那条流干干净净：一页拉完、增量也没有更多。
      if (q.get('category') === 'credential') {
        return q.has('since') ? { items: [], hasMore: false } : { items: [ev(50)], hasMore: false };
      }
      return q.has('since')
        ? { items: [ev(400), ev(399), ev(398)], hasMore: true }
        : { items: [ev(100)], hasMore: false };
    });

    const { result, rerender } = renderStream();
    await waitFor(() => {
      expect(result.current.gap).toEqual({ afterSeq: 100, beforeSeq: 398 });
    });
    expect(result.current.gapIndex).not.toBeNull();

    rerender({ filters: { category: 'credential' } });

    // ⚠️ 换 key 的**那一帧**就得是 null：用 useEffect 清的话会先渲染一帧带着旧洞的新列表。
    expect(result.current.gap).toBeNull();
    expect(result.current.gapIndex).toBeNull();

    await waitFor(() => {
      expect(result.current.rows.map((r) => r.seq)).toEqual([50]);
    });
    expect(result.current.gap).toBeNull();
  });

  it('切走再切回**同一条**流 ⇒ 洞还在（它属于这条流，缓存也还在，清掉才是撒谎）', async () => {
    // ⚠️ 这条是上一条的"别修过头"保险：③ 要的是"洞绑定到 key"，不是"任何重渲染都清洗"。
    // 谁把清空写成"filters 引用一变就清"，上一条照旧绿，只有这条会红
    // ——而线上表现是：用户切个类别再切回来，一个真实存在的洞就此消失。
    serve((q) => {
      if (q.get('category') === 'credential') {
        return q.has('since') ? { items: [], hasMore: false } : { items: [ev(50)], hasMore: false };
      }
      return q.has('since')
        ? { items: [ev(400), ev(399), ev(398)], hasMore: true }
        : { items: [ev(100)], hasMore: false };
    });

    const { result, rerender } = renderStream();
    await waitFor(() => {
      expect(result.current.gap).toEqual({ afterSeq: 100, beforeSeq: 398 });
    });
    rerender({ filters: { category: 'credential' } });
    expect(result.current.gap).toBeNull();

    rerender({ filters: {} });
    expect(result.current.gap).toEqual({ afterSeq: 100, beforeSeq: 398 });
  });
});

describe('④ isError 与"空数组"是两个可区分状态', () => {
  it('500 ⇒ rows.length === 0 **且** isError === true（窄化掉 isError 就是本页最坏的谎）', async () => {
    serve(() => new HttpResponse(null, { status: 500 }));

    const { result } = renderStream();
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.isPending).toBe(false);
  });

  it('真的没有记录 ⇒ rows 为空但 isError === false', async () => {
    serve(() => ({ items: [], hasMore: false }));

    const { result } = renderStream();
    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.isError).toBe(false);
  });
});

describe('⑤ since 取的是「已见最大 seq」，不是首屏末尾 seq', () => {
  it('首屏降序 100…81 ⇒ 增量请求带 since=100（带 81 会把中间 19 条重复拉回来）', async () => {
    const first = Array.from({ length: 20 }, (_, i) => ev(100 - i));
    serve((q) =>
      q.has('since') ? { items: [], hasMore: false } : { items: first, hasMore: false },
    );

    renderStream();
    await waitFor(() => {
      expect(requests.some((q) => q.has('since'))).toBe(true);
    });
    expect(requests.find((q) => q.has('since'))?.get('since')).toBe('100');
  });

  it('向下滚出更老的一页后，since 仍是最大 seq（不跟着最老的走）', async () => {
    serve((q) => {
      if (q.has('since')) return { items: [], hasMore: false };
      const before = q.get('before');
      return before === null
        ? { items: [ev(100), ev(99)], hasMore: true }
        : { items: [ev(50), ev(49)], hasMore: false };
    });

    const { result } = renderStream();
    await waitFor(() => {
      expect(result.current.hasOlder).toBe(true);
    });
    requests = [];
    act(() => {
      result.current.fetchOlder();
    });
    await waitFor(() => {
      expect(result.current.rows).toHaveLength(4);
    });
    for (const q of requests.filter((r) => r.has('since'))) {
      expect(q.get('since')).toBe('100');
    }
  });
});

describe('⑥ 空表不是"到此为止"：一行都没有时也得自己动起来', () => {
  it('⭐ 首屏 `{"items":[],"hasMore":false}` ⇒ 推进 30s 仍会再拉一次（**无游标**首屏语义），新事件自己出现', async () => {
    // ⚠️ 这条针对的现场 100% 命中"全新部署第一次打开系统状态页"，而它看起来完全正常：
    //    首屏空 ⇒ 没有已见 seq ⇒ 增量通道（必须带 `since`）根本启动不了；
    //    历史 query 又是 `staleTime: Infinity`，连窗口聚焦都不重拉。
    //    于是用户在另一个标签页建了项目、表里已经有了 5 行，面板**停在「暂无记录」不动**，
    //    只有整页刷新才会更新。
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let screens = 0;
    serve((q) => {
      if (q.has('since')) return { items: [], hasMore: false };
      screens += 1;
      return screens === 1
        ? { items: [], hasMore: false }
        : { items: [ev(5), ev(4)], hasMore: false };
    });

    const { result } = renderStream();
    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.isError).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    await waitFor(() => {
      expect(result.current.rows.map((r) => r.seq)).toEqual([5, 4]);
    });
    // 补拉走的是**首屏语义**：既不带 since（没有已见 seq 可给），也不带 before。
    const firstScreens = requests.filter((q) => !q.has('since') && !q.has('before'));
    expect(firstScreens).toHaveLength(2);
  });

  it('⛔ 一旦有了行，历史方向**立刻停止轮询**（否则就是 ② 明令禁止的"重拉已加载的页"）', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let screens = 0;
    serve((q) => {
      if (q.has('since')) return { items: [], hasMore: false };
      screens += 1;
      return screens === 1 ? { items: [], hasMore: false } : { items: [ev(5)], hasMore: false };
    });

    const { result } = renderStream();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => {
      expect(result.current.rows).toHaveLength(1);
    });

    requests = [];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // 之后只剩增量方向在动：一个 before 都没有，也不再重打首屏。
    expect(requests.filter((q) => !q.has('since'))).toHaveLength(0);
    expect(requests.filter((q) => q.has('since')).length).toBeGreaterThan(0);
  });
});

describe('⑦ 增量通道挂了要说出来（"静默停止更新"伪装成"没有新事件"）', () => {
  it('首屏成功 + 增量 500 ⇒ `isLiveUpdateError` 为真，而 `isError` 与列表**不受影响**', async () => {
    serve((q) =>
      q.has('since')
        ? new HttpResponse(null, { status: 500 })
        : { items: [ev(100)], hasMore: false },
    );

    const { result } = renderStream();
    await waitFor(() => {
      expect(result.current.isLiveUpdateError).toBe(true);
    });
    // ⛔ 一次轮询失败不许升级成整面板不可用：历史方向是好的，列表照旧。
    expect(result.current.isError).toBe(false);
    expect(result.current.rows.map((r) => r.seq)).toEqual([100]);
  });

  it('增量恢复后提示消失（[重试] 不是死胡同）', async () => {
    let failed = false;
    serve((q) => {
      if (!q.has('since')) return { items: [ev(100)], hasMore: false };
      if (!failed) {
        failed = true;
        return new HttpResponse(null, { status: 500 });
      }
      return { items: [ev(101)], hasMore: false };
    });

    const { result } = renderStream();
    await waitFor(() => {
      expect(result.current.isLiveUpdateError).toBe(true);
    });
    act(() => {
      result.current.retryLiveUpdate();
    });
    await waitFor(() => {
      expect(result.current.isLiveUpdateError).toBe(false);
    });
    expect(result.current.rows.map((r) => r.seq)).toEqual([101, 100]);
  });
});

describe('[加载中间部分] —— 一次只填一段', () => {
  it('点一次 ⇒ 发一个 before=gap.beforeSeq 的请求，洞收窄后**不再自动继续**', async () => {
    serve((q) => {
      if (q.has('since')) return { items: [ev(400), ev(399), ev(398)], hasMore: true };
      const before = q.get('before');
      if (before === '398') return { items: [ev(397), ev(300)], hasMore: true };
      return { items: [ev(100)], hasMore: false };
    });

    const { result } = renderStream();
    await waitFor(() => {
      expect(result.current.gap).toEqual({ afterSeq: 100, beforeSeq: 398 });
    });

    requests = [];
    act(() => {
      result.current.fillGap();
    });
    await waitFor(() => {
      expect(result.current.gap).toEqual({ afterSeq: 100, beforeSeq: 300 });
    });
    // 只发了这一个填充请求：⛔ 不循环追平到底。
    expect(requests.filter((q) => q.get('before') === '398')).toHaveLength(1);
    expect(requests.filter((q) => q.has('before'))).toHaveLength(1);
    expect(result.current.rows.map((r) => r.seq)).toEqual([400, 399, 398, 397, 300, 100]);
  });

  it('填到接回已加载历史 ⇒ 洞闭合（gap 变回 null）', async () => {
    serve((q) => {
      if (q.has('since')) return { items: [ev(400), ev(399), ev(398)], hasMore: true };
      const before = q.get('before');
      if (before === '398') return { items: [ev(397), ev(101)], hasMore: true };
      return { items: [ev(100)], hasMore: false };
    });

    const { result } = renderStream();
    await waitFor(() => {
      expect(result.current.gap).not.toBeNull();
    });
    act(() => {
      result.current.fillGap();
    });
    await waitFor(() => {
      expect(result.current.gap).toBeNull();
    });
  });
});
