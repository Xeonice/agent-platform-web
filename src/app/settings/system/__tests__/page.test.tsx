// 系统状态页栅格布局的回归用例（Phase 1 补做：design/design-notes.md §1「系统状态左列
// 大片空白」+ `design/prototype.html` #system 区块）。
//
// ⚠️ 这是本仓第一个 `app/**/page.tsx` 单测——之所以在这里破例，是因为「两栏栅格 / 窄屏
// 回落单列」这件事的开关（`lg:grid-cols-2`）与「三张卡不跨列强制等高」这条纪律都钉在
// `page.tsx` 这一层（`SystemStatusContainer` 只管两列各自分组，栅格容器本身在这里，见
// 该文件顶部注释），而 jsdom 不跑真实 CSS 布局引擎，只能靠类名断言把这两件事钉住——
// 这正是任务要求的"类名断言"路线（另一条"story viewport 参数"路线不适用于纯类名开关）。
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import SystemStatusPage from '@/app/settings/system/page';

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(): ReturnType<typeof render> {
  const client = makeClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<SystemStatusPage />, { wrapper: Wrapper });
}

describe('系统状态页两栏栅格（Phase 1 补做）', () => {
  it('栅格容器带 grid-cols-1 + lg:grid-cols-2——这正是「lg 及以上两栏、以下回落单列」的开关本身', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 2, name: /本机资源水位/ });

    const grid = screen.getByTestId('system-status-grid');
    // ⚠️ 注入验证①：把 `lg:grid-cols-2` 从 page.tsx 删掉，这条断言就会红——它锁的是
    // "两栏"这半，不是随便一个 `grid` 类名（单独留 `grid-cols-1` 时窄屏/宽屏长得一样）。
    expect(grid).toHaveClass('grid', 'grid-cols-1', 'lg:grid-cols-2');
    // ⛔ 不强制等高：design-notes.md §1 记着 v1「三列卡片强制等高空出一大截」已被 v2
    // 推翻——这里落地为栅格容器不给 `items-stretch`。
    expect(grid).not.toHaveClass('items-stretch');
    expect(grid).toHaveClass('items-start');
  });

  it('三个栅格子项按序：左列 → 右列 → 审计流整行（lg:col-span-2），审计流不跟两列强制等高', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 2, name: /本机资源水位/ });

    const grid = screen.getByTestId('system-status-grid');
    const children = Array.from(grid.children);
    // ⚠️ 注入验证②：把审计流挪到栅格最前面、或把左右两列顺序对调，都会让下面这条
    // 按 `data-testid` 记录的顺序断言变红。
    expect(children.map((el) => el.getAttribute('data-testid'))).toEqual([
      'system-status-column-left',
      'system-status-column-right',
      'system-status-audit-row',
    ]);

    const auditRow = screen.getByTestId('system-status-audit-row');
    expect(auditRow).toHaveClass('lg:col-span-2');
    // 审计流是栅格的直接子项（跨两列的整行），不是塞进某一列内部。
    expect(auditRow.parentElement).toBe(grid);
    expect(screen.getByRole('heading', { level: 2, name: /审计流/ })).toBeInTheDocument();
  });
});
