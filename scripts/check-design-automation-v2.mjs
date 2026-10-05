import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// All HTTP and websocket traffic is intercepted. Only this script's fixtures are mutated.
const origin = process.argv[2] ?? 'http://localhost:3100';
const output = resolve(
  process.argv[3] ??
    fileURLToPath(new URL('../../artifacts/design-automation-v2/', import.meta.url)),
);
const scenario = process.env['DESIGN_REVIEW_SCENARIO'];
assert.ok(scenario === undefined || /^(dark|light):(1440|1024|390)$/.test(scenario));
const now = '2026-10-05T00:00:00Z';
const projects = ['web', 'api'].map((name) => ({
  id: `aut-${name}`,
  name: `acme-${name}`,
  sourceType: 'empty',
  cloneStatus: 'ready',
  cloneErrorCode: null,
  taskCount: 0,
  createdAt: now,
  updatedAt: now,
}));
const rule = {
  id: 'aut-nightly',
  projectId: 'aut-web',
  name: '每天凌晨跑一遍回归',
  runtime: 'codex',
  prompt: '运行回归测试并汇总结果',
  scheduleKind: 'daily',
  scheduleConfig: { time: '08:00' },
  timezone: 'Asia/Shanghai',
  timeoutMinutes: 120,
  artifactRetentionDays: 7,
  triggerOn: 'failure',
  enabled: false,
  degraded: true,
  consecutiveFailures: 10,
  createdAt: now,
  updatedAt: now,
};
const runs = Array.from({ length: 42 }, (_, index) => ({
  id: `run-${String(index)}`,
  automationId: rule.id,
  status: index === 11 ? 'failed' : 'success',
  retryCount: 0,
  triggeredAt: new Date(Date.parse(now) - index * 3_600_000).toISOString(),
  startedAt: now,
  completedAt: now,
  sandboxId: `finished-${String(index)}`,
  ...(index === 11
    ? {
        errorMessage: 'regression failed: expected 42',
        outputSummary: '1 regression check failed',
        webhookStatus: 'failed',
      }
    : {}),
}));
const artifact = {
  id: 'artifact-11',
  projectId: 'aut-web',
  sandboxId: 'finished-11',
  sandboxName: '第 12 次自动回归',
  sourceAutomationId: rule.id,
  sourceAutomationName: rule.name,
  source: 'automation-artifact',
  retainedAt: now,
  retainUntil: '2026-10-12T00:00:00Z',
  diskBytes: 1024 ** 3,
  downloadBytes: 512 * 1024 ** 2,
};
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
  retainedVolumes: {
    count: 1,
    totalBytes: 1024 ** 3,
    percentOfDisk: 0.2,
    level: 'ok',
    truncated: false,
  },
  activeTasks: 0,
};
const runtimes = [
  {
    id: 'codex',
    displayName: 'Codex',
    vendor: 'OpenAI',
    authMethods: ['api-key'],
    credentialStatus: 'active',
    maskedIdentifier: 'a***@example.com',
    credentials: [],
  },
];

async function focused(locator) {
  await locator
    .page()
    .waitForFunction(
      (element) => element === document.activeElement,
      await locator.elementHandle(),
    );
}
async function capture(page, result, name) {
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${name}: no page overflow`,
  );
  assert.equal(await page.getByRole('dialog').count(), 1, `${name}: exactly one dialog`);
  const file = `${name}-${result.theme}-${result.width}.png`;
  await page.screenshot({ path: resolve(output, file), animations: 'disabled' });
  result.screenshots.push(file);
}
async function preservesProject(page) {
  const state = await page.evaluate(
    () => JSON.parse(localStorage.getItem('agent-platform-ui')).state,
  );
  assert.equal(
    state.selectedProjectId,
    'aut-api',
    'Opening another project’s rules preserves the current project',
  );
  assert.equal(state.selectedSandboxId, null);
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
try {
  for (const theme of ['dark', 'light'])
    for (const width of [1440, 1024, 390]) {
      if (scenario !== undefined && scenario !== `${theme}:${width}`) continue;
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
      let currentRules = [{ ...rule }];
      let previewAvailable = true;
      let releaseDelete;
      try {
        await page.addInitScript((theme) => {
          if (localStorage.getItem('agent-platform-ui') !== null) return;
          localStorage.setItem(
            'agent-platform-ui',
            JSON.stringify({
              state: {
                theme,
                sidebarCollapsed: false,
                selectedProjectId: 'aut-api',
                selectedSandboxId: null,
                selectedSandboxTerminalAt: null,
                bannerDismissedToday: {},
              },
              version: 0,
            }),
          );
        }, theme);
        await page.route('**/api/**', async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          const path = url.pathname;
          if (request.method() === 'DELETE' && path === `/api/automations/${rule.id}`) {
            result.mutations.push({ method: 'DELETE', path });
            await new Promise((resolve) => {
              releaseDelete = resolve;
            });
            currentRules = [];
            await route.fulfill({ status: 204 });
            return;
          }
          if (request.method() !== 'GET') {
            result.errors.push(`Unexpected fixture mutation ${request.method()} ${path}`);
            await route.fulfill({
              status: 405,
              json: {
                code: 'REVIEW_ONLY',
                message: 'Unsupported fixture action',
                retryable: false,
              },
            });
            return;
          }
          if (path.endsWith('/deletion-preview') && !previewAvailable) {
            await route.fulfill({
              status: 503,
              json: { code: 'INTERNAL', message: 'preview unavailable', retryable: true },
            });
            return;
          }
          let json = [];
          if (path === '/api/system/init-status') json = { initialized: true, initializedAt: now };
          else if (path === '/api/health') json = { status: 'ok' };
          else if (path === '/api/projects') json = projects;
          else if (path === '/api/runtimes') json = runtimes;
          else if (path === '/api/providers')
            json = [
              {
                name: 'aio',
                isDefault: true,
                capabilities: {
                  spawnTty: true,
                  volumeMount: true,
                  updateResources: true,
                  pauseResume: false,
                  snapshot: false,
                  watchEvents: true,
                  headlessTask: true,
                },
              },
            ];
          else if (path === '/api/automations/attention')
            json = currentRules.map((item) => ({
              id: item.id,
              name: item.name,
              projectId: item.projectId,
              projectName: 'acme-web',
              status: 'autoDisabled',
              consecutiveFailures: 10,
            }));
          else if (/^\/api\/projects\/[^/]+\/automations$/.test(path))
            json = currentRules.filter((item) => item.projectId === path.split('/')[3]);
          else if (path.endsWith('/deletion-preview'))
            json = {
              runCount: 42,
              artifactCount: 3,
              runningTasks: [{ id: 'live-task', name: '正在跑的回归' }],
            };
          else if (path.endsWith('/runs')) {
            const cursor = url.searchParams.get('before');
            const start = cursor === null ? 0 : runs.findIndex((item) => item.id === cursor) + 1;
            json = { items: runs.slice(start, start + 20), hasMore: start + 20 < runs.length };
          } else if (path === '/api/retained-volumes') json = [artifact];
          else if (path === '/api/system/resources') json = resources;
          else if (path === '/api/system/providers')
            json = { providers: [], runtimes: [], imageSpecs: [], healthWindowMs: 3_600_000 };
          else if (path === '/api/system/settings') json = {};
          else if (path === '/api/system/version')
            json = { version: '0.2.4', commit: 'automation-review', builtAt: now };
          else if (path === '/api/system/audit') json = { items: [], hasMore: false };
          await route.fulfill({ json });
        });
        await page.routeWebSocket(/socket\.io/, (socket) => socket.close());
        await page.goto(origin);
        const bannerEntry = page.getByRole('button', { name: '查看这些规则', exact: true });
        await bannerEntry.click();
        const modal = page.getByTestId('automations-modal');
        await modal.waitFor();
        await page.getByTestId('automation-list-item').waitFor();
        assert.match(await modal.innerText(), /在 acme-web 中/);
        assert.match(await modal.innerText(), /Codex · 每天/);
        assert.equal(await modal.locator('.lucide-square').count(), 0);
        await preservesProject(page);
        result.checks.crossProjectBanner = true;
        await capture(page, result, 'list');
        await page.getByTestId('automation-show-failure').click();
        await page.getByTestId('run-error-message').waitFor();
        const failureButton = page
          .getByTestId('run-history-item')
          .nth(11)
          .getByTestId('run-toggle-detail');
        await focused(failureButton);
        assert.equal(await failureButton.getAttribute('aria-expanded'), 'true');
        assert.equal(await page.getByTestId('run-history-item').count(), 20);
        assert.match(await page.getByTestId('run-history-total').innerText(), /已加载 20 次/);
        assert.equal(await page.getByTestId('run-open-task').count(), 0);
        result.checks.failureBeyondPreviewAndFocus = true;
        await capture(page, result, 'failure-12');
        await page.getByTestId('run-history-load-more').click();
        await page.waitForFunction(
          () => document.querySelectorAll('[data-testid="run-history-item"]').length === 40,
        );
        await page.getByTestId('run-history-load-more').click();
        await page.waitForFunction(
          () => document.querySelectorAll('[data-testid="run-history-item"]').length === 42,
        );
        assert.match(await page.getByTestId('run-history-total').innerText(), /共 42 次/);
        result.checks.cursorPagination42 = true;
        await page.getByRole('button', { name: '查看成果', exact: true }).click();
        await page.getByRole('dialog', { name: '保留下来的成果', exact: true }).waitFor();
        const retainedRow = page.getByTestId('retained-volume-row');
        assert.match(await retainedRow.innerText(), new RegExp(rule.name));
        assert.match(await retainedRow.getAttribute('class'), /border-ring/);
        result.checks.finishedArtifactNavigation = true;
        await capture(page, result, 'artifact');
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        await bannerEntry.click();
        await page.getByTestId('automation-select').click();
        await page.getByTestId('detail-delete').click();
        await page.waitForFunction(() =>
          document
            .querySelector('[data-testid="detail-delete-confirm"]')
            ?.textContent.includes('42 次运行历史'),
        );
        assert.match(await modal.innerText(), /3 份运行成果/);
        assert.match(await modal.innerText(), /正在跑的回归/);
        await focused(page.getByTestId('detail-delete-confirm-no'));
        result.checks.authoritativeDeletePreview = true;
        await capture(page, result, 'delete');
        await page.keyboard.press('Escape');
        await page.getByTestId('automation-detail').waitFor();
        assert.equal(await page.getByRole('dialog').count(), 1);
        result.checks.confirmEscapeReturnsDetail = true;
        await page.getByTestId('detail-back').click();
        await page.getByTestId('automation-create').click();
        const form = page.getByTestId('automation-form');
        await form.waitFor();
        assert.equal(await form.getByRole('alert').count(), 0);
        assert.equal(await page.getByTestId('form-save').isDisabled(), true);
        const name = form.getByTestId('form-name');
        await name.fill('长'.repeat(61));
        await name.press('Tab');
        await form.getByText('规则名称最多 60 个字。', { exact: true }).waitFor();
        assert.equal(await name.getAttribute('aria-invalid'), 'true');
        await page.setViewportSize({ width, height: 560 });
        const saveBox = await page.getByTestId('form-save').boundingBox();
        const closeBox = await modal
          .getByRole('button', { name: '关闭', exact: true })
          .boundingBox();
        assert.ok(
          saveBox && closeBox && saveBox.y + saveBox.height <= 560 && closeBox.y >= 0,
          'Short viewport keeps header and footer visible',
        );
        result.checks.untouchedValidationAndFixedFooter = true;
        await capture(page, result, 'form-short');
        await page.getByTestId('form-cancel').click();
        await page.setViewportSize({ width, height: 900 });
        await page.getByTestId('automation-select').click();
        previewAvailable = false;
        await page.getByTestId('detail-delete').click();
        await page
          .getByTestId('detail-delete-confirm')
          .getByText(/全部运行历史/)
          .waitFor();
        assert.doesNotMatch(
          await page.getByTestId('detail-delete-confirm').innerText(),
          /0 次运行历史|0 份运行成果/,
        );
        result.checks.unknownPreviewDoesNotInventCounts = true;
        await page.getByTestId('detail-delete-confirm-yes').click();
        await page.getByRole('button', { name: '正在删除…', exact: true }).waitFor();
        assert.equal(await page.getByTestId('detail-delete-confirm-no').isDisabled(), true);
        assert.equal(
          await modal.getByRole('button', { name: '关闭', exact: true }).isDisabled(),
          true,
        );
        await page.keyboard.press('Escape');
        assert.equal(await page.getByTestId('detail-delete-confirm').isVisible(), true);
        assert.ok(releaseDelete, 'Deletion request reached the intercepted fixture');
        releaseDelete();
        await page.getByTestId('automation-empty').waitFor();
        result.checks.busyDeleteGuardAndSuccess = true;
        await preservesProject(page);
        assert.deepEqual(result.errors, []);
        result.status = 'passed';
      } catch (error) {
        result.status = 'failed';
        result.errors.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
        await page
          .screenshot({
            path: resolve(output, `failure-${theme}-${width}.png`),
            animations: 'disabled',
          })
          .catch(() => {
            /* A closing page can prevent the supplemental screenshot. */
          });
      } finally {
        releaseDelete?.();
        await page.close();
      }
    }
} finally {
  await browser.close();
  await writeFile(resolve(output, 'review.json'), JSON.stringify(results, null, 2));
}
assert.equal(
  results.filter((item) => item.status === 'failed').length,
  0,
  JSON.stringify(
    results.filter((item) => item.status === 'failed'),
    null,
    2,
  ),
);
