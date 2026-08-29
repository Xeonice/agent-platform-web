import { test, expect, type Page } from '@playwright/test';
import type { AuditEventDto, AuditListDto } from '../src/types/audit';
import type { SystemProvidersDto, SystemResourcesDto } from '../src/types/system';

// F21-5 §7.4（v1.1 场景 5–7）+ §9.2 VS-3 的真浏览器那一段。
// REST 用 `page.route`（E2E 层**不启 MSW**，12 §4.1：Service Worker 会让请求对 page.route 不可见）。
//
// ⚠️ 场景 5 的原文是「真实创建一个 Task → 回本页断言出现 provision 行」。那条依赖真后端 +
// 真 sandbox provider，不属于 CI 里这一层能稳定跑的东西；这里退到**同一条断言的可测部分**：
// 审计行渲染的是**一句人话**（后端 `summary` 直接上 UI），不是 JSON 串。剩下的"事件真的会被
// 记下来"属于后端验收（`api/apps/api/test/e2e/audit.e2e-spec.ts`）。

function ev(seq: number, overrides: Partial<AuditEventDto> = {}): AuditEventDto {
  return {
    seq,
    at: new Date(Date.UTC(2026, 7, 26, 5, 45, 30, seq % 1000)).toISOString(),
    category: 'sandbox',
    type: 'sandbox.provision.stage',
    severity: 'info',
    subjectType: 'sandbox',
    subjectId: 'sb-1',
    actor: 'system',
    summary: `沙箱 sb-1 完成 workspace 准备（#${String(seq)}）`,
    durationMs: 4231,
    outcome: 'ok',
    ...overrides,
  };
}

/**
 * 替身**在服务端一侧**筛 `severity`（后端是逗号分隔多值 + `WHERE severity IN (...)`）。
 * 不实现它，「仅告警」在真浏览器里就退化成"筛了个寂寞"，而断言照样能凑出来。
 */
function bySeverity(query: URLSearchParams, items: AuditEventDto[]): AuditEventDto[] {
  const raw = query.get('severity');
  if (raw === null) return items;
  const wanted = raw.split(',');
  return items.filter((e) => wanted.includes(e.severity));
}

/** 记录每一个审计请求的 query，并按 query 决定回什么。 */
async function routeAudit(
  page: Page,
  respond: (query: URLSearchParams) => AuditListDto,
): Promise<URLSearchParams[]> {
  const seen: URLSearchParams[] = [];
  await page.route('**/api/system/audit?**', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    seen.push(query);
    await route.fulfill({ json: respond(query) });
  });
  await page.route('**/api/system/audit', async (route) => {
    seen.push(new URLSearchParams());
    await route.fulfill({ json: respond(new URLSearchParams()) });
  });
  return seen;
}

/**
 * 四张卡（资源 / provider / 连接 / 诊断）与审计卡**同屏共存**（P21-5 §10.1：两者不合并）。
 *
 * ⚠️ 本文件测的是审计那一块，但页面挂载时资源与 provider 两个 query 会真的发出去 ——
 * 不 stub 它们，这些用例就依赖"CI 里恰好没有后端、于是请求失败得很快"，那是**用环境
 * 兜住的测试**。stub 掉之后，本文件的每一条断言都只取决于审计那条流。
 */
const GB = 1024 ** 3;
const RESOURCES: SystemResourcesDto = {
  cpu: { cores: 8, loadAvg1m: 0.8, usedPercent: 10, level: 'ok' },
  ram: { totalBytes: 16 * GB, usedBytes: 3.2 * GB, usedPercent: 20, level: 'ok' },
  disk: {
    path: '/data',
    totalBytes: 200 * GB,
    usedBytes: 120 * GB,
    availableBytes: 80 * GB,
    usedPercent: 60,
    level: 'ok',
    reservedPercent: 15,
  },
  retainedVolumes: { count: 0, totalBytes: 0, percentOfDisk: 0, level: 'ok', truncated: false },
  activeTasks: 0,
};
const SYSTEM_PROVIDERS: SystemProvidersDto = {
  providers: [],
  runtimes: [],
  imageSpecs: [],
  healthWindowMs: 3_600_000,
};

test.describe('F21-5 审计流', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/health', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/system/resources', (route) => route.fulfill({ json: RESOURCES }));
    await page.route('**/api/system/providers', (route) =>
      route.fulfill({ json: SYSTEM_PROVIDERS }),
    );
  });

  test('设置菜单可进入系统状态页，审计区渲染人话 summary（不是 JSON 串）', async ({ page }) => {
    await page.route('**/api/credentials?*', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/credentials', (route) => route.fulfill({ json: [] }));
    await page.route('**/api/runtimes', (route) => route.fulfill({ json: [] }));
    await routeAudit(page, (q) =>
      q.has('since') ? { items: [], hasMore: false } : { items: [ev(1200)], hasMore: false },
    );

    await page.goto('/settings/credentials');
    await page.getByRole('button', { name: '⚙️ 系统状态' }).click();
    await expect(page).toHaveURL(/\/settings\/system$/);

    const row = page.getByTestId('audit-row-1200');
    await expect(row).toContainText('沙箱 sb-1 完成 workspace 准备');
    // summary 是人话：整行里不该出现 JSON 结构串。
    await expect(row).not.toContainText('{"');
    // 耗时经过人话化（4231ms → 4.2s），不是裸毫秒数。
    await expect(row).toContainText('4.2s');
    await expect(row).not.toContainText('4231');
  });

  test('VS-3 步 1–4：首屏不带游标 → 滚动带 before → 切筛选后不带旧 before', async ({ page }) => {
    const seen = await routeAudit(page, (q) => {
      if (q.has('since')) return { items: [], hasMore: false };
      const before = q.get('before');
      if (before === null) {
        const page = [ev(1200, { severity: 'error', summary: '沙箱 sb-1 创建失败' }), ev(1199)];
        const items = bySeverity(q, page);
        return { items, hasMore: items.length > 1 };
      }
      return { items: bySeverity(q, [ev(1198)]), hasMore: false };
    });

    await page.goto('/settings/system');
    await expect(page.getByTestId('audit-row-1200')).toBeVisible();

    // ① 首屏请求不带 since / before。
    const first = seen[0];
    expect(first?.has('since')).toBe(false);
    expect(first?.has('before')).toBe(false);

    // ② 向下滚一页 ⇒ before=<当前最老 seq>，且不带 offset/page。
    await page.getByRole('button', { name: '加载更早的记录' }).click();
    await expect(page.getByTestId('audit-row-1198')).toBeVisible();
    const older = seen.filter((q) => q.has('before'));
    expect(older[0]?.get('before')).toBe('1199');
    expect(seen.some((q) => q.has('offset') || q.has('page'))).toBe(false);

    // ③ 切「仅告警」⇒ 新请求不带旧 before（key 变化天然重置游标），
    //    且**带 `severity=warn,error`**：这一档是服务端筛的，客户端不再裁。
    const cursorBefore = seen.length;
    await page.getByLabel('仅告警').check();
    await expect(page.getByTestId('audit-row-1199')).toHaveCount(0);
    await expect(page.getByTestId('audit-row-1200')).toBeVisible();
    const afterSwitch = seen.slice(cursorBefore);
    expect(afterSwitch.every((q) => !q.has('before'))).toBe(true);
    expect(afterSwitch.some((q) => q.get('severity') === 'warn,error')).toBe(true);
  });

  test('场景 6：[查看该沙箱完整时间线] 后列表只含该 subjectId', async ({ page }) => {
    await routeAudit(page, (q) => {
      if (q.has('since')) return { items: [], hasMore: false };
      if (q.get('subjectId') === 'sb-1') return { items: [ev(1200)], hasMore: false };
      return {
        items: [ev(1200), ev(1199, { subjectId: 'sb-2', summary: '沙箱 sb-2 已回收' })],
        hasMore: false,
      };
    });

    await page.goto('/settings/system');
    await expect(page.getByTestId('audit-row-1199')).toBeVisible();

    await page
      .getByTestId('audit-row-1200')
      .getByRole('button', { name: '查看该沙箱完整时间线' })
      .click();

    await expect(page.getByTestId('audit-row-1200')).toBeVisible();
    await expect(page.getByTestId('audit-row-1199')).toHaveCount(0);
  });

  test('场景 7：[导出日志] 触发下载，文件名以 .tar.gz 结尾', async ({ page }) => {
    await routeAudit(page, () => ({ items: [ev(1200)], hasMore: false }));
    // ⚠️ **`context.route` 而不是 `page.route`**：导出链接是 `target="_blank"`，请求发生在
    // 新开的那个页面上，而 `page.route` 只作用于注册它的那一页、**不传给 popup**。
    // 用 `page.route` 的话这条请求会绕过替身直奔真网络，测试却仍能凑出绿色——
    // 断言的东西早就不是替身回的了。
    await page.context().route('**/api/system/audit/export', (route) =>
      route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/gzip',
          'content-disposition': 'attachment; filename="audit-export-2026-08-26.tar.gz"',
        },
        body: 'fake-tar-gz-bytes',
      }),
    );

    await page.goto('/settings/system');
    await expect(page.getByTestId('audit-row-1200')).toBeVisible();

    const [download] = await Promise.all([
      // `target="_blank"` 开的那一页当场变成下载并自己关掉，事件仍报在发起页上。
      page.waitForEvent('download'),
      page.getByRole('button', { name: '导出日志' }).click(),
    ]);
    // 内容校验属后端验收（包内四份 + 截取范围）；前端只验触发下载与文件名。
    expect(download.suggestedFilename()).toMatch(/\.tar\.gz$/);
    // 成功路径下应用本身不动 —— 这正是"漏了 target 也完全看不出来"的那一面：
    // 只有失败路径（下一条）才会暴露。
    await expect(page).toHaveURL(/\/settings\/system$/);
    await expect(page.getByTestId('audit-row-1200')).toBeVisible();
  });

  test('⭐ 导出失败**不把整个 SPA 导航掉**（失败时后端回的是 JSON 信封，不是附件）', async ({
    page,
  }) => {
    // ⚠️ 成功路径（`Content-Disposition: attachment`）下浏览器下载、页面不动，
    //    所以"漏了 target"在成功时完全看不出来。失败时响应是 `application/json`
    //    且没有那个头：同标签页导航会把应用连同用户的筛选与滚动位置一起换成一张裸 JSON 页。
    await routeAudit(page, (q) =>
      q.has('since') ? { items: [], hasMore: false } : { items: [ev(1200)], hasMore: false },
    );
    // 同上：必须是 `context.route`，否则这条请求根本不会被替身接住（popup 不继承 page 级路由）。
    await page.context().route('**/api/system/audit/export', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'EXPORT_FAILED',
          message: '导出失败：磁盘空间不足',
          retryable: true,
          sideEffectFree: true,
        }),
      }),
    );

    await page.goto('/settings/system');
    await expect(page.getByTestId('audit-row-1200')).toBeVisible();

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('button', { name: '导出日志' }).click(),
    ]);

    // 那张裸 JSON 错误页落在**新标签页**里（先证明它真的落到了这里，否则本条什么也没验）。
    await expect(popup.locator('body')).toContainText('EXPORT_FAILED');
    // 而应用本身原地不动：URL 没变、筛选条还在、列表还在。
    await expect(page).toHaveURL(/\/settings\/system$/);
    await expect(page.getByTestId('audit-row-1200')).toBeVisible();
    await popup.close();
  });

  /**
   * ★ 真浏览器里的空态第三档「该类事件平台尚未记录」**当前没有真实实例**，这条守的是它的反面。
   *
   * 契约给五个类别，而后端"今天写不写"是另一回事：2026-08-28 之前 `image` / `system`
   * 一条都不写，选中「镜像」得到「当前筛选无匹配记录」时用户读出来的是"镜像相关操作从来没
   * 发生过"，于是他会去调严重度、调时间范围——而调到天荒地老也不会有记录。那天后端补齐了
   * 这两档的写入点，`AUDIT_CATEGORY_EMIT_STATUS`（`lib/audit/auditStream.ts`）随之全标
   * `emitted`，**「镜像筛空」的正确答案因此从「尚未记录」变成了「当前筛选无匹配记录」**。
   *
   * ⚠️ 否定断言仍是这条的重点：**两句话同时渲染时，肯定断言照样绿。**
   * 第三档今天的覆盖在 `lib/audit/__tests__/auditStream.test.ts`（显式传表）与
   * `AuditStreamCard.view.stories.tsx`（props 驱动）——真浏览器这一层没有办法在
   * 「五个类别全有生产者」的现实下把它构造出来，也不该为了构造它去改生产代码。
   */
  test('后端在写的类别（镜像 / 凭证）筛空 ⇒ 「当前筛选无匹配记录」，「该类事件平台尚未记录」不出现', async ({
    page,
  }) => {
    const seen = await routeAudit(page, (q) => {
      if (q.has('since')) return { items: [], hasMore: false };
      // 替身照真后端来：一挑类别就筛不到（`ev()` 是 `sandbox` 类）。
      return q.has('category')
        ? { items: [], hasMore: false }
        : { items: [ev(1200)], hasMore: false };
    });

    await page.goto('/settings/system');
    await expect(page.getByTestId('audit-row-1200')).toBeVisible();

    await page.getByLabel('类别').selectOption('image');

    await expect(page.getByText('当前筛选无匹配记录')).toBeVisible();
    await expect(page.getByText('类别：镜像')).toBeVisible();
    await expect(page.getByText('该类事件平台尚未记录')).toHaveCount(0);
    await expect(page.getByText('暂无记录')).toHaveCount(0);
    // ⛔ 「知道后端不写」**不许**变成"干脆不发请求"：后端补上写入点的当天（镜像这一档
    //    恰好就是那天），那一版会变成一个永远空白的页面，而没有任何东西会红。
    expect(seen.some((q) => q.get('category') === 'image')).toBe(true);
    // 出路还在。
    await expect(page.getByRole('button', { name: '清除筛选' })).toBeVisible();

    // ⭐ 换到另一个类别、同样筛空 ⇒ 结论一致。这一半守的是反向漂移：写成"只要挑了类别
    //    就说尚未记录"的那一版，一次真实的"这个类别最近没事发生"会被冤成"平台没记过凭证事件"。
    await page.getByLabel('类别').selectOption('credential');
    // ⚠️ 先等筛选说明换过来：两次的主句是同一句，只断言主句的话，这一半在"切换根本没生效"
    //    时也会绿（上一次的空态还挂在屏幕上）。
    await expect(page.getByText('类别：凭证')).toBeVisible();
    await expect(page.getByText('当前筛选无匹配记录')).toBeVisible();
    await expect(page.getByText('该类事件平台尚未记录')).toHaveCount(0);
  });

  // ————————————————————————————————————————————————————————————————
  // 四张卡与审计卡同屏（F21-5 §3 组件树 · P21-5 §10.1「两种日志不合并」）
  // ————————————————————————————————————————————————————————————————
  test('资源 / provider / 连接 / 诊断四张卡与审计卡同屏共存，且互不合并', async ({ page }) => {
    await page.route('**/api/system/resources', (route) =>
      route.fulfill({
        json: {
          ...RESOURCES,
          // 磁盘 96% 而 CPU/RAM 正常：整体取**最差维度**（审计 P1-9）。
          disk: {
            path: '/data',
            totalBytes: 200 * GB,
            usedBytes: 192 * GB,
            availableBytes: 8 * GB,
            usedPercent: 96,
            level: 'critical',
            reservedPercent: 15,
          },
        } satisfies SystemResourcesDto,
      }),
    );
    await routeAudit(page, (q) =>
      q.has('since') ? { items: [], hasMore: false } : { items: [ev(1200)], hasMore: false },
    );

    await page.goto('/settings/system');

    // 四张卡各自的标题都在（组件树 §3）。
    await expect(page.getByRole('heading', { name: '📊 资源池水位' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '🏃 Provider 状态' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '🌐 连接状态' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '🔧 诊断' })).toBeVisible();
    // ⚠️ 审计卡是**另一个区块**，不是被并进任何一张卡里（P21-5 §10.1）。
    await expect(page.getByRole('heading', { name: '🧾 审计流' })).toBeVisible();
    await expect(page.getByTestId('audit-row-1200')).toBeVisible();

    // ⭐ 取最差维度：平均会把这台机器算成健康，而它一个 Task 都建不出来。
    await expect(page.getByText('资源耗尽，无法创建新 Task')).toBeVisible();
    await expect(page.getByText('资源充足')).toHaveCount(0);

    // 诊断还没跑过 ⇒ **不画八行占位**（清单由服务端首帧下发，不是本地常量）。
    await expect(page.getByTestId('diagnostic-item-container-runtime')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重新诊断' })).toBeEnabled();
  });

  test('接口 500 ⇒ 「加载失败」，且页面上没有「暂无记录」', async ({ page }) => {
    await page.route('**/api/system/audit**', (route) => route.fulfill({ status: 500, body: '' }));

    await page.goto('/settings/system');
    await expect(page.getByText('❌ 审计流加载失败')).toBeVisible();
    // 真浏览器里再钉一次这条否定断言：失败**不许**伪装成空——三句空态文案一句都不许有。
    await expect(page.getByText('暂无记录')).toHaveCount(0);
    await expect(page.getByText('当前筛选无匹配记录')).toHaveCount(0);
    await expect(page.getByText('该类事件平台尚未记录')).toHaveCount(0);
  });
});
