import { test, expect, type Page } from '@playwright/test';
import { stubInitialized } from './initGate';

// F21-7 §7.4 的本页独有场景（用 mock 边界跑真实链路，12 §4）：
//   ① 项目级入口 → 侧弹层打开，标题带作用域项目名；
//   ② 新建规则 → 列表出现该规则且带下次触发时间；
//   ③ ⭐ **编辑只改 prompt 时，PUT 请求体的键集合不含 `timezone`**（23 I-AUT-9 / §9.1 #32）
//      —— 这条是本页唯一"错了也不会有任何报错、只会让凌晨任务悄悄搬家"的 bug，
//      单测与 container 测各钉过一遍，e2e 再从真实浏览器钉一遍（浏览器时区就在那儿摆着，
//      是最容易被顺手读进请求体的东西）；
//   ④ 八个 run status 在真实 DOM 上分得开，且只有 failed/timeout 计入连续失败。
//
// ⚠️ §7.4 还列了「组头「⋯」→ [⚙️ 自动化规则]」与「MVP 入口禁用态」两条：
//    `ProjectMenuPanel`（组头「⋯」）全仓不存在，入口现挂在项目只读条上（见交付报告），
//    所以这里按**已落地的入口**写；「禁用态 + v1.1 角标」那条更不适用——这一轮就是把它做出来。

test.beforeEach(async ({ page }) => {
  await stubInitialized(page);
});

const PROJECT = {
  id: 'proj-auto',
  name: 'E2E 自动化项目',
  sourceType: 'empty',
  cloneStatus: 'ready',
  cloneErrorCode: null,
  taskCount: 0,
  createdAt: new Date().toISOString(),
};

const RULE = {
  id: 'auto-1',
  projectId: 'proj-auto',
  name: '每天凌晨数据分析',
  runtime: 'codex',
  prompt: '汇总昨天的错误日志',
  scheduleKind: 'daily',
  scheduleConfig: { time: '08:00' },
  // ⭐ 刻意用一个**不太可能等于跑测试那台机器**的时区：时区若被隐式重传，
  //    请求体里出现的会是浏览器时区，与这个值不同，断言才有分辨力。
  timezone: 'Pacific/Chatham',
  timeoutMinutes: 120,
  artifactRetentionDays: 7,
  enabled: true,
  degraded: false,
  consecutiveFailures: 0,
  nextTriggerAt: '2026-09-01T00:00:00.000Z',
};

async function stubBase(page: Page): Promise<void> {
  await page.route('**/api/health', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/projects', (route) => route.fulfill({ status: 200, json: [PROJECT] }));
  await page.route('**/api/providers', (route) => route.fulfill({ status: 200, json: [] }));
  await page.route('**/api/runtimes', (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: 'codex',
          displayName: 'Codex',
          vendor: 'OpenAI',
          authMethods: ['api-key'],
          credentialStatus: 'active',
          maskedIdentifier: 'a***@example.com',
          credentials: [],
        },
      ],
    }),
  );
}

/** 打开自动化侧弹层（入口今天在项目只读条上，见交付报告的入口偏离说明）。 */
async function openPanel(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /E2E 自动化项目/ }).click();
  await page.getByTestId('open-automations').click();
  await expect(page.getByTestId('modal-automations')).toBeVisible();
}

test.describe('F21-7 自动化规则面板', () => {
  test('入口打开侧弹层，标题带作用域项目名；列表显示下次触发时间与时区', async ({ page }) => {
    await stubBase(page);
    await page.route('**/api/projects/*/automations', (route) =>
      route.fulfill({ status: 200, json: [RULE] }),
    );

    await openPanel(page);
    await expect(page.getByTestId('modal-automations')).toContainText('E2E 自动化项目');

    const item = page.getByTestId('automation-list-item');
    await expect(item).toHaveAttribute('data-lifecycle', 'on');
    await expect(page.getByTestId('automation-summary')).toContainText('下次:');
    // ⭐ 时区显示的是**规则的快照**，不是浏览器的。
    await expect(page.getByTestId('automation-timezone')).toContainText('Pacific/Chatham');
  });

  test('新建规则 → 列表出现该规则且显示下次触发时间', async ({ page }) => {
    await stubBase(page);
    let created = false;
    await page.route('**/api/projects/*/automations', async (route) => {
      if (route.request().method() === 'POST') {
        created = true;
        await route.fulfill({ status: 201, json: { ...RULE, id: 'auto-new', name: '夜间回归' } });
        return;
      }
      await route.fulfill({
        status: 200,
        json: created ? [{ ...RULE, id: 'auto-new', name: '夜间回归' }] : [],
      });
    });
    await page.route('**/api/automations/*/runs*', (route) =>
      route.fulfill({ status: 200, json: { items: [], hasMore: false } }),
    );

    await openPanel(page);
    await page.getByTestId('automation-empty').waitFor();
    await page.getByTestId('automation-create').click();

    await page.getByTestId('form-name').fill('夜间回归');
    await page.getByTestId('form-runtime').selectOption('codex');
    await page.getByTestId('form-prompt').fill('跑一遍回归用例');
    await page.getByTestId('form-save').click();

    await expect(page.getByTestId('automation-detail')).toBeVisible();
    await page.getByTestId('detail-back').click();
    await expect(page.getByTestId('automation-list-item')).toContainText('夜间回归');
    await expect(page.getByTestId('automation-summary')).toContainText('下次:');
  });

  test('⭐ 只改 prompt 保存 → PUT 请求体的键集合不含 timezone（I-AUT-9）', async ({ page }) => {
    await stubBase(page);
    await page.route('**/api/projects/*/automations', (route) =>
      route.fulfill({ status: 200, json: [RULE] }),
    );
    await page.route('**/api/automations/*/runs*', (route) =>
      route.fulfill({ status: 200, json: { items: [], hasMore: false } }),
    );

    let putKeys: string[] = [];
    await page.route('**/api/automations/auto-1', async (route) => {
      if (route.request().method() === 'PUT') {
        const body: unknown = route.request().postDataJSON();
        putKeys = typeof body === 'object' && body !== null ? Object.keys(body) : [];
        await route.fulfill({ status: 200, json: RULE });
        return;
      }
      await route.fallback();
    });

    await openPanel(page);
    await page.getByTestId('automation-select').click();
    await page.getByTestId('detail-edit').click();
    // 时区框里摆的是 Pacific/Chatham，但**不去碰它**。
    await expect(page.getByTestId('schedule-timezone')).toHaveValue('Pacific/Chatham');
    await page.getByTestId('form-prompt').fill('汇总昨天的错误日志，并附上耗时 top10');
    await page.getByTestId('form-save').click();

    await expect(page.getByTestId('automation-detail')).toBeVisible();
    expect(putKeys.length).toBeGreaterThan(0);
    // ★ 键集合断言：断言值相等会放过"传了一个恰好相同的时区"。
    expect(putKeys).not.toContain('timezone');
    expect(putKeys).toContain('prompt');
  });

  test('⭐ 八个 run status 在真实 DOM 上分得开：只有 failed/timeout 计入连续失败', async ({
    page,
  }) => {
    await stubBase(page);
    await page.route('**/api/projects/*/automations', (route) =>
      route.fulfill({ status: 200, json: [RULE] }),
    );
    const statuses = [
      { id: 'r1', status: 'success' },
      { id: 'r2', status: 'failed' },
      { id: 'r3', status: 'timeout' },
      { id: 'r4', status: 'skipped', errorCode: 'AUTH_EXPIRED' },
      { id: 'r5', status: 'skipped', errorCode: 'PREVIOUS_RUNNING' },
      { id: 'r6', status: 'missed' },
      { id: 'r7', status: 'resource-exhausted', retryCount: 3 },
      { id: 'r8', status: 'running' },
    ].map((r) => ({
      automationId: 'auto-1',
      retryCount: 0,
      triggeredAt: '2026-08-31T00:00:00.000Z',
      startedAt: '2026-08-31T00:00:00.000Z',
      ...r,
    }));
    await page.route('**/api/automations/*/runs*', (route) =>
      route.fulfill({
        status: 200,
        json: { items: statuses, hasMore: false },
      }),
    );

    await openPanel(page);
    await page.getByTestId('automation-select').click();
    const items = page.getByTestId('run-history-item');
    await expect(items).toHaveCount(8);

    // 四类分得开：❌ 真失败 / ⏭️ 跳过 / 🕳️ 错过 / ⚠️ 排队。
    await expect(items.nth(1)).toHaveAttribute('data-category', 'failure');
    await expect(items.nth(3)).toHaveAttribute('data-category', 'skipped');
    await expect(items.nth(5)).toHaveAttribute('data-category', 'missed');
    await expect(items.nth(6)).toHaveAttribute('data-category', 'waiting');

    // ⭐ 只有 failed / timeout 计入连续失败（P21-7 §4 计数口径）。
    for (const i of [1, 2]) {
      await expect(items.nth(i)).toHaveAttribute('data-counts-toward-failure', 'true');
    }
    for (const i of [0, 3, 4, 5, 6, 7]) {
      await expect(items.nth(i)).toHaveAttribute('data-counts-toward-failure', 'false');
    }

    // ⭐ missed 展开后必须说清"不是规则失败 / 不补跑"。
    await items.nth(5).getByTestId('run-toggle-detail').click();
    await expect(items.nth(5).getByTestId('run-detail')).toContainText('不是规则失败');
    await expect(items.nth(5).getByTestId('run-detail')).toContainText('不会补跑');
  });

  test('面板内列表 ⇄ 表单是视图切换，DOM 里始终只有一层 dialog', async ({ page }) => {
    await stubBase(page);
    await page.route('**/api/projects/*/automations', (route) =>
      route.fulfill({ status: 200, json: [RULE] }),
    );

    await openPanel(page);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.getByTestId('automation-create').click();
    await expect(page.getByTestId('automation-form')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.getByTestId('form-cancel').click();
    await expect(page.getByTestId('automation-list')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
  });
});
