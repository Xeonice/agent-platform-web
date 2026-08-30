import { test, expect, type Page } from '@playwright/test';
import type { InitStatusDto, SystemResourcesDto, SystemSettingsDto } from '../src/types/system';
import { INITIALIZED_STATUS } from './initGate';

// F21-8 §7.4（本页独有补充场景 1/2/3 的可测部分）+ §9.2 VS-1 的真浏览器那一段。
// REST 用 `page.route`（E2E 层**不启 MSW**，12 §4.1：Service Worker 会让请求对 page.route 不可见）。
//
// ⚠️ 场景 3「离线模式下 [+ 新任务] 置灰」在本轮**测不了**：工作台侧的全局横幅与置灰
//    （`useGlobalBanner`）在本仓还不存在（F21-8 §4 把它列为本页对其它页面的唯一持续输出，
//    但那一半属于工作台）。⇒ 本文件只覆盖向导自己那一半，横幅那一条留给它落地时补。

const GB = 1024 ** 3;

const ONLINE: NonNullable<InitStatusDto['lastConnectivityCheck']> = [
  { target: 'api.anthropic.com', ok: true, latencyMs: 1925, modelApi: true },
  { target: 'api.openai.com', ok: true, latencyMs: 351, modelApi: true },
  { target: 'localhost:5001', ok: true, latencyMs: 6, modelApi: false },
];

const SETTINGS: SystemSettingsDto = {
  initialized: false,
  accessPasscodeEnabled: false,
  version: { platform: 'dev', node: 'v22.22.0' },
};

const RESOURCES: SystemResourcesDto = {
  cpu: { cores: 10, loadAvg1m: 3.7, usedPercent: 37, level: 'ok' },
  ram: { totalBytes: 32 * GB, usedBytes: 24 * GB, usedPercent: 76.7, level: 'ok' },
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

function sse(obj: Record<string, unknown>): string {
  return `event: ${String(obj['event'])}\ndata: ${JSON.stringify(obj)}\n\n`;
}

const DIAGNOSE_BODY = [
  sse({ event: 'start', checks: [], timeoutMs: 5000 }),
  sse({
    event: 'check',
    id: 'outbound-network',
    label: '外网连通（模型 API / 镜像仓库）',
    status: 'ok',
    summary: '均可达',
    detail: { results: ONLINE },
    durationMs: 293,
  }),
  sse({
    event: 'check',
    id: 'preset-image',
    label: '预制镜像就绪',
    status: 'ok',
    step: 'staged',
    summary: '预制镜像就绪：已注册、已在本机铺开',
    durationMs: 22,
  }),
  sse({ event: 'done', okCount: 2, infoCount: 0, warnCount: 0, failCount: 0, totalMs: 300 }),
].join('');

interface RouteOpts {
  /** 首次 `init-status` 的返回；`POST /init` 成功后自动切成 `initialized:true`。 */
  initialized?: boolean;
}

/** 记录每一次 `POST /api/system/init` 的请求体（断言"保存 ≠ 放行"用）。 */
async function routeInitApis(page: Page, opts: RouteOpts = {}): Promise<{ initCalls: number }> {
  const state = { initialized: opts.initialized ?? false, initCalls: 0 };

  await page.route('**/api/system/init-status', async (route) => {
    await route.fulfill({
      json: state.initialized
        ? INITIALIZED_STATUS
        : {
            initialized: false,
            lastConnectivityCheck: ONLINE,
            lastConnectivityCheckAt: '2026-08-29T16:11:34.000Z',
          },
    });
  });
  await page.route('**/api/system/settings', async (route) => {
    await route.fulfill({ json: SETTINGS });
  });
  await page.route('**/api/system/resources', async (route) => {
    await route.fulfill({ json: RESOURCES });
  });
  await page.route('**/api/system/init', async (route) => {
    state.initCalls += 1;
    state.initialized = true;
    await route.fulfill({ status: 201, json: INITIALIZED_STATUS });
  });
  await page.route('**/api/system/diagnose', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-schema-hash': 'sb-diagnose-v1' },
      body: DIAGNOSE_BODY,
    });
  });
  // 工作台在放行之后会去拉这些；给空数据，让"工作台真的挂起来了"这件事可断言。
  await page.route('**/api/projects*', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/sandboxes*', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/runtimes*', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/health*', async (route) => {
    await route.fulfill({ json: { status: 'ok' } });
  });

  return state;
}

test.describe('F21-8 · 首次冷启动的阻塞式向导', () => {
  test('场景 1：全新实例走完向导 ⇒ URL 仍是 `/`，工作台就地出现（不经中间空白页）', async ({
    page,
  }) => {
    const state = await routeInitApis(page);
    await page.goto('/');

    await expect(page.getByTestId('init-wizard')).toBeVisible();
    // 进向导直接渲染历史结果（不重跑），并带着它的时刻。
    await expect(page.getByTestId('connectivity-checked-at')).toContainText('上次检测');

    // 全通过 ⇒ 跳过代理那一步，直接到第 3 步。
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.getByTestId('preset-image-check')).toBeVisible();
    await expect(page.getByTestId('preset-step-staged')).toHaveAttribute('data-state', 'pass');

    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.getByTestId('resource-confirm')).toBeVisible();
    await page.getByRole('button', { name: '确认，开始使用' }).click();

    await expect(page.getByTestId('init-wizard')).toHaveCount(0);
    // ⚠️ URL 全程没动过：拦截靠"不渲染"，不是 redirect（§2）。
    expect(new URL(page.url()).pathname).toBe('/');
    expect(state.initCalls).toBe(1);
  });

  test('场景 2：初始化完成后刷新 ⇒ 向导不再出现（一次性）', async ({ page }) => {
    await routeInitApis(page, { initialized: true });
    await page.goto('/');
    await expect(page.getByTestId('init-wizard')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('init-wizard')).toHaveCount(0);
  });

  test('⭐ 未初始化时的深链 `/settings/images` ⇒ 仍是向导，URL 不动（不做 redirect）', async ({
    page,
  }) => {
    await routeInitApis(page);
    await page.goto('/settings/images');

    await expect(page.getByTestId('init-wizard')).toBeVisible();
    // ⚠️ 两条否定断言：设置页的内容一点都不许渲染，而 URL 也不许被改写
    //    —— redirect 会让用户完成初始化后回不到他原本要去的地方。
    await expect(page.getByRole('heading', { name: '🖼️ 镜像管理' })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/settings/images');
  });

  test('⭐ 阻塞语义：向导里没有 [取消]，按 Esc 也逃不掉', async ({ page }) => {
    await routeInitApis(page);
    await page.goto('/');
    await expect(page.getByTestId('init-wizard')).toBeVisible();

    await expect(page.getByRole('button', { name: '取消' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('init-wizard')).toBeVisible();
  });
});
