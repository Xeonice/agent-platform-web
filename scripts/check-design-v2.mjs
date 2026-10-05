import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// All API traffic is intercepted. This review never creates or deletes platform resources.
const origin = process.argv[2] ?? 'http://localhost:3100';
const output = resolve(
  process.argv[3] ?? fileURLToPath(new URL('../../artifacts/design-v2/', import.meta.url)),
);
const now = '2026-10-05T00:00:00.000Z';
const projects = ['web', 'api'].map((name) => ({
  id: `design-${name}`,
  name: `acme-${name}`,
  sourceType: 'empty',
  cloneStatus: 'ready',
  cloneErrorCode: null,
  taskCount: 0,
  createdAt: now,
  updatedAt: now,
}));
const digest = `sha256:${'a'.repeat(64)}`;
const images = [
  {
    id: 'design-manifest',
    imageId: 'design-image',
    imageName: '平台预制镜像',
    isBuiltin: true,
    ref: 'ghcr.io/acme/agent-platform:aio-v0.2.4',
    version: 'aio-v0.2.4',
    baseImage: 'ubuntu:24.04',
    digest,
    entrypointContract: { workdir: '/workspace', entrypoint: ['/usr/local/bin/agent-platform'] },
    supportedRuntimes: ['codex', 'claude-code'],
    resourceDefaults: { cores: 2, ramMb: 4096, diskMb: 10240 },
    labelsRequired: [],
    derivedFromDigest: null,
    validationStatus: 'valid',
    validationErrors: null,
    isActive: true,
    imageConfig: { env: [] },
    registeredAt: now,
    resolvedAt: now,
  },
];
const attention = [
  {
    projectId: 'design-web',
    projectName: 'acme-web',
    id: 'design-nightly',
    name: '每天生成发布说明草稿',
    status: 'autoDisabled',
    consecutiveFailures: 10,
  },
  {
    projectId: 'design-api',
    projectName: 'acme-api',
    id: 'design-hourly',
    name: '每小时检查构建告警',
    status: 'degraded',
    consecutiveFailures: 3,
  },
];
const rules = attention.map((item) => ({
  id: item.id,
  projectId: item.projectId,
  name: item.name,
  runtime: 'codex',
  prompt: '整理检查结果并生成摘要',
  scheduleKind: 'daily',
  scheduleConfig: { time: '08:00' },
  timezone: 'Asia/Shanghai',
  timeoutMinutes: 120,
  artifactRetentionDays: 7,
  triggerOn: 'failure',
  enabled: item.status === 'degraded',
  degraded: true,
  consecutiveFailures: item.consecutiveFailures,
  createdAt: now,
  updatedAt: now,
}));
const resources = {
  cpu: { cores: 8, loadAvg1m: 0.6, usedPercent: 12, level: 'ok' },
  ram: { totalBytes: 32 * 1024 ** 3, usedBytes: 8 * 1024 ** 3, usedPercent: 25, level: 'ok' },
  disk: {
    path: '/data',
    totalBytes: 500 * 1024 ** 3,
    usedBytes: 210 * 1024 ** 3,
    availableBytes: 290 * 1024 ** 3,
    usedPercent: 42,
    level: 'ok',
    reservedPercent: 10,
  },
  retainedVolumes: { count: 0, totalBytes: 0, percentOfDisk: 0, level: 'ok', truncated: false },
  activeTasks: 0,
};

function fixture(path) {
  if (path === '/api/system/init-status') return { initialized: true, initializedAt: now };
  if (path === '/api/health') return { status: 'ok' };
  if (path === '/api/projects') return projects;
  if (path === '/api/images') return images;
  if (path === '/api/automations/attention') return attention;
  if (/^\/api\/projects\/[^/]+\/automations$/.test(path)) {
    return rules.filter((rule) => rule.projectId === path.split('/')[3]);
  }
  if (path === '/api/system/settings') return {};
  if (path === '/api/system/resources') return resources;
  if (path === '/api/system/providers') {
    return { providers: [], runtimes: [], imageSpecs: [], healthWindowMs: 3_600_000 };
  }
  if (path === '/api/system/version')
    return { version: '0.2.4', commit: 'design-review', builtAt: now };
  if (path === '/api/system/audit') return { items: [], hasMore: false };
  return [];
}

async function screenshot(page, result, name) {
  const filename = `${name}-${result.theme}-${result.width}.png`;
  await page.screenshot({ path: `${output}/${filename}`, fullPage: true });
  result.screenshots.push(filename);
}

async function layout(page, expectedSidebarWidth) {
  const metrics = await page.evaluate(() => {
    const sidebar = document.querySelector('#workbench-sidebar');
    const mainHeader = [...document.querySelectorAll('header')].find((header) =>
      header.querySelector('h1'),
    );
    const body = getComputedStyle(document.body);
    return {
      sidebarCount: document.querySelectorAll('#workbench-sidebar').length,
      sidebarWidth: sidebar?.getBoundingClientRect().width ?? null,
      headerHeight: mainHeader?.getBoundingClientRect().height ?? null,
      fontFamily: body.fontFamily,
      background: body.backgroundColor,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      pageHeight: document.documentElement.scrollHeight,
    };
  });
  assert.equal(metrics.sidebarCount, 1, 'Pages must share a single sidebar');
  assert.equal(
    metrics.sidebarWidth,
    expectedSidebarWidth,
    'Sidebar width must match the v2 layout',
  );
  assert.equal(metrics.headerHeight, 56, 'The main header must be 56px high');
  assert.equal(metrics.horizontalOverflow, false, 'The page must not overflow horizontally');
  assert.ok(metrics.pageHeight <= 900, 'Scrolling must stay inside the page content');
  return metrics;
}

async function sameSidebar(page, sidebar) {
  assert.equal(
    await page.evaluate(
      (original) =>
        original.isConnected && original === document.querySelector('#workbench-sidebar'),
      sidebar,
    ),
    true,
    'Client-side navigation must preserve the sidebar DOM node',
  );
}

async function focused(locator) {
  await locator
    .page()
    .waitForFunction(
      (element) => document.activeElement === element,
      await locator.elementHandle(),
    );
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
try {
  for (const theme of ['dark', 'light']) {
    for (const width of [1440, 1024, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(15_000);
      const result = {
        theme,
        width,
        status: 'running',
        checks: {},
        screenshots: [],
        errors: [],
        mutations: [],
      };
      results.push(result);
      page.on('pageerror', (error) => result.errors.push(error.message));
      try {
        await page.addInitScript((theme) => {
          localStorage.setItem(
            'agent-platform-ui',
            JSON.stringify({
              state: {
                theme,
                sidebarCollapsed: false,
                selectedProjectId: null,
                selectedSandboxId: null,
                bannerDismissedToday: {},
              },
              version: 0,
            }),
          );
        }, theme);
        await page.route('**/api/**', async (route) => {
          const request = route.request();
          const path = new URL(request.url()).pathname;
          if (request.method() !== 'GET') {
            result.mutations.push({ method: request.method(), path });
            await route.fulfill({
              status: 405,
              json: { code: 'REVIEW_READ_ONLY', message: 'Read-only review', retryable: false },
            });
            return;
          }
          await route.fulfill({ json: fixture(path) });
        });
        await page.routeWebSocket(/socket\.io/, (socket) => socket.close());
        await page.goto(origin);
        const nav = page.getByRole('navigation', { name: '主导航' });
        await nav.waitFor();
        const newTask = page.getByTestId('new-task-entry');
        await newTask.waitFor();
        await page.waitForFunction((button) => !button.disabled, await newTask.elementHandle());
        await page.getByTestId('banner-automation-needs-attention').waitFor();
        await page.evaluate(() => document.fonts.ready);
        const expectedSidebarWidth = width < 640 ? 48 : 256;
        result.layout = await layout(page, expectedSidebarWidth);
        const sidebar = await page.locator('#workbench-sidebar').elementHandle();
        assert.ok(sidebar, 'Sidebar must be mounted');
        result.checks.initialLayout = true;
        if (width >= 640) {
          await page.getByRole('button', { name: '收起侧栏', exact: true }).click();
          await layout(page, 48);
          await page.getByRole('button', { name: '展开侧栏', exact: true }).click();
          await layout(page, 256);
          await sameSidebar(page, sidebar);
          result.checks.collapsedRail48 = true;
        } else {
          result.checks.mobileRail48 = true;
        }
        await screenshot(page, result, 'workbench');

        const find = page.getByRole('button', { name: '查找任务、项目与动作（⌘K）', exact: true });
        await find.focus();
        const chord = process.platform === 'darwin' ? 'Meta+k' : 'Control+k';
        await page.keyboard.press(chord);
        const palette = page.getByTestId('command-palette');
        await palette.waitFor();
        const input = palette.getByRole('combobox', { name: '查找任务、项目与动作' });
        await focused(input);
        await input.fill('新建');
        await page.waitForFunction(
          () => document.querySelector('[role="option"]')?.id === 'command-new-project',
        );
        const ids = await palette
          .getByRole('option')
          .evaluateAll((options) => options.map((option) => option.id));
        assert.deepEqual(
          ids,
          ['command-new-project', 'command-new-task'],
          'Name prefixes must rank ahead of synonym matches',
        );
        result.checks.commandSearchOrder = ids;
        await screenshot(page, result, 'command-new');

        await input.fill('zzz');
        await palette.getByRole('status').filter({ hasText: '没有找到匹配“zzz”的结果' }).waitFor();
        assert.equal(
          await palette.getByRole('option').count(),
          0,
          'Empty search must not keep stale options',
        );
        result.checks.emptySearch = true;
        await screenshot(page, result, 'command-empty');

        await input.fill('清屏');
        const clear = palette.locator('#command-clear');
        await clear.waitFor();
        assert.equal(await clear.getAttribute('aria-disabled'), 'true');
        assert.match(await clear.innerText(), /当前没有终端/);
        const beforeClearUrl = page.url();
        await input.press('Enter');
        assert.equal(
          await palette.isVisible(),
          true,
          'Disabled Enter must not execute or close the palette',
        );
        assert.equal(await input.inputValue(), '清屏');
        assert.equal(page.url(), beforeClearUrl);
        assert.equal(await page.getByRole('dialog').count(), 1);
        result.checks.disabledClearEnter = true;
        await screenshot(page, result, 'command-disabled');
        await input.press('Escape');
        await palette.waitFor({ state: 'detached' });
        await focused(find);
        result.checks.escapeRestoresFocus = true;

        const shortcuts = page.getByRole('button', { name: '快捷键', exact: true });
        await shortcuts.click();
        const shortcutsDialog = page.getByRole('dialog', { name: '快捷键', exact: true });
        await shortcutsDialog.waitFor();
        assert.match(await shortcutsDialog.innerText(), /⌘K \/ Ctrl K/);
        await screenshot(page, result, 'shortcuts');
        await page.keyboard.press('Escape');
        await shortcutsDialog.waitFor({ state: 'detached' });
        await focused(shortcuts);
        result.checks.shortcutsEntry = true;

        result.settings = [];
        for (const [title, path] of [
          ['镜像管理', '/settings/images'],
          ['凭证管理', '/settings/credentials'],
          ['系统状态', '/settings/system'],
        ]) {
          await nav.getByRole('link', { name: title, exact: true }).click();
          await page.waitForURL((url) => url.pathname === path);
          await page.getByRole('heading', { name: title, exact: true, level: 1 }).waitFor();
          if (path === '/settings/images') {
            await page.getByTestId('image-card').waitFor();
          } else if (path === '/settings/system') {
            await page.getByTestId('system-status-diagnostics-row').waitFor();
          }
          await sameSidebar(page, sidebar);
          const metrics = await layout(page, expectedSidebarWidth);
          assert.equal(
            await nav.getByRole('link', { name: title, exact: true }).getAttribute('aria-current'),
            'page',
          );
          await screenshot(page, result, path.split('/').at(-1));
          result.settings.push({ path, sameSidebar: true, ...metrics });
        }
        await nav.getByRole('link', { name: '任务', exact: true }).click();
        await page.waitForURL((url) => url.pathname === '/');
        await newTask.waitFor();
        await sameSidebar(page, sidebar);
        await layout(page, expectedSidebarWidth);
        result.checks.sharedSidebarAcrossSettings = true;
        assert.deepEqual(result.mutations, [], 'Review actions must not trigger API mutations');
        assert.deepEqual(result.errors, [], 'No browser runtime errors are allowed');
        result.status = 'passed';
      } catch (error) {
        result.status = 'failed';
        result.failure = error instanceof Error ? error.message : String(error);
        await screenshot(page, result, 'failure').catch((captureError) => {
          result.errors.push(`Screenshot: ${captureError.message}`);
        });
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await writeFile(`${output}/review.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(JSON.stringify(results, null, 2));
const failed = results.filter((result) => result.status !== 'passed');
if (failed.length > 0)
  throw new Error(`${failed.length} design review scenarios failed; see ${output}/review.json`);
