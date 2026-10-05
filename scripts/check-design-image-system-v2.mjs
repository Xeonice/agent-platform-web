import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { configure, frames } from './design-image-system.fixtures.mjs';

const origin = process.argv[2] ?? 'http://localhost:3100';
const output = resolve(
  process.argv[3] ??
    fileURLToPath(new URL('../../artifacts/design-image-system-v2/', import.meta.url)),
);
const selectedScenario = process.env['DESIGN_REVIEW_SCENARIO'];
const selectedFrame = process.env['DESIGN_REVIEW_FRAME'];
const selectedDomain = process.env['DESIGN_REVIEW_DOMAIN'];
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const manifestPath = resolve(
  repositoryRoot,
  'artifacts/migration-audit/image-system-design-manifest.json',
);
assert.ok(!selectedDomain || ['IMG', 'AUT', 'SYS'].includes(selectedDomain));
assert.ok(!selectedScenario || /^(dark|light):(1440|1024|390)$/.test(selectedScenario));
assert.ok(!selectedFrame || frames.some((frame) => frame.id === selectedFrame));
const manifest = {
  owner: 'automation_attention',
  scope: ['IMG', 'AUT', 'SYS', 'DIA', 'AUD'],
  verificationStatus: 'planned-not-run',
  runner: 'web/scripts/check-design-image-system-v2.mjs',
  execution:
    'DESIGN_REVIEW_SCENARIO=dark:1440 DESIGN_REVIEW_FRAME=f-img-register-06 pnpm exec node scripts/check-design-image-system-v2.mjs http://localhost:3100; omit selectors for all 55 drafts × six screens',
  frames: frames.map((frame) => ({
    ...frame,
    draftId: frame.id,
    verificationStatus:
      frame.id === 'f-sys-audit-03' ? 'not-applicable-current-emission' : 'planned-not-run',
    ...(frame.id === 'f-sys-audit-03'
      ? {
          reason:
            'All five current audit categories have real producers; the approved historical not-yet-emitted frame is unreachable with current API data. Production fallback remains covered by code review; no invented source state.',
        }
      : {}),
    fixture: {
      module: 'web/scripts/design-image-system.fixtures.mjs',
      configuration: `configure(${frame.id})`,
      requests:
        'All /api/** and socket.io traffic intercepted; SSE Responses use deterministic frames and a real ReadableStream, never direct app-store diagnostic writes',
      mutations: 'In-memory fixture only',
    },
    coverage: [
      'dark/light × 1440/1024/390',
      'production-route-and-state',
      'no-horizontal-overflow',
      'accessible-primary-state',
      'screenshot',
    ],
    evidence: [],
  })),
};
await mkdir(resolve(output, '..'), { recursive: true });
let reviewedOrigin = null;
try {
  const previous = JSON.parse(await readFile(manifestPath, 'utf8'));
  reviewedOrigin = previous.executionSummary?.production ?? null;
  for (const frame of manifest.frames) {
    const existing = previous.frames?.find(
      (row) => row.draftId === frame.draftId && row.source === frame.source,
    );
    if (existing?.evidence?.length) {
      frame.evidence = existing.evidence;
      frame.verificationStatus = existing.verificationStatus;
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
async function saveManifest() {
  manifest.verificationStatus = manifest.frames.every((frame) =>
    ['browser-passed', 'not-applicable-current-emission'].includes(frame.verificationStatus),
  )
    ? 'browser-executed'
    : 'partially-executed';
  const evidence = manifest.frames.flatMap((frame) => frame.evidence);
  manifest.executionSummary = {
    production: reviewedOrigin,
    drafts: frames.length,
    passedCombinations: evidence.filter((entry) => entry.status === 'passed').length,
    notApplicableCombinations: evidence.filter(
      (entry) => entry.status === 'not-applicable-current-emission',
    ).length,
    failedCombinations: evidence.filter((entry) => entry.status === 'failed').length,
    sources: [...new Set(evidence.map((entry) => entry.review))],
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
await saveManifest();
if (process.argv.includes('--validate')) {
  assert.equal(frames.length, 55);
  console.log(`Validated ${frames.length} repository draft frames; no browser execution claimed.`);
  process.exit(0);
}
await mkdir(output, { recursive: true });
reviewedOrigin = origin;
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
async function exercise(page, fixture) {
  const { group, state, id } = fixture.frame;
  const current = page.locator('[data-testid="image-card"][data-image-id="custom-current"]');
  if (group === 'f-img-page') {
    await (
      state === 2
        ? page.getByTestId('image-card-skeleton').first()
        : state === 3
          ? page.getByRole('button', { name: '重试', exact: true })
          : page.getByTestId('images-empty')
    ).waitFor();
    return;
  }
  if (group === 'f-img-register') {
    await page.getByRole('button', { name: '+ 注册新镜像', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '注册新镜像', exact: true });
    if (state === 5) {
      await dialog.getByRole('button', { name: '查看镜像要求', exact: true }).click();
      await page.getByRole('complementary', { name: '平台对镜像的要求' }).waitFor();
      return;
    }
    const uri = dialog.getByRole('textbox', { name: '镜像 URI', exact: true });
    await uri.fill('docker.io/acme/ml-agent:v1.0');
    await dialog.getByRole('button', { name: '验证', exact: true }).click();
    if (state === 6) {
      await dialog.getByRole('button', { name: '重试', exact: true }).waitFor();
      assert.equal(await uri.inputValue(), 'docker.io/acme/ml-agent:v1.0');
      return;
    }
    await dialog.getByTestId('validation-result').waitFor();
    if (state === 2) {
      assert.equal(await dialog.getByRole('button', { name: '保存', exact: true }).count(), 0);
      return;
    }
    if (state === 3) {
      await uri.fill('docker.io/acme/ml-agent: v2');
      assert.equal(await uri.getAttribute('aria-invalid'), 'true');
      await dialog.getByTestId('conclusion-invalidated').waitFor();
      return;
    }
    if (state === 4) {
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      await dialog.getByTestId('duplicate-hint').waitFor();
    }
    return;
  }
  if (group === 'f-img-env') {
    await current.first().getByRole('button', { name: '编辑环境变量', exact: true }).click();
    const editor = page.getByTestId('env-var-editor');
    await editor.waitFor();
    if (state === 2) {
      await editor.getByRole('textbox', { name: '变量名 1', exact: true }).fill('1BAD');
      await current.first().getByRole('button', { name: '保存运行参数', exact: true }).click();
      await editor.getByRole('alert').first().waitFor();
    }
    if (state === 3) {
      const add = editor.getByRole('button', { name: '+ 添加变量', exact: true });
      assert.equal(await add.getAttribute('aria-disabled'), 'true');
      await add.focus();
      assert.equal(await editor.getByTestId('env-var-row').count(), 50);
    }
    return;
  }
  if (group === 'f-img-state') {
    await current.first().waitFor();
    if (state === 1) {
      await current.first().getByText('已禁用', { exact: true }).waitFor();
      return;
    }
    if (state === 4) {
      await page
        .getByTestId('image-card')
        .filter({ has: page.getByText('预制', { exact: true }) })
        .getByRole('button', { name: '禁用', exact: true })
        .click();
      await page.getByRole('dialog', { name: /禁用预制镜像/ }).waitFor();
      return;
    }
    await current.first().getByRole('button', { name: '删除', exact: true }).click();
    const deletion = page.getByTestId('image-delete-confirm');
    await deletion.waitFor();
    await deletion.getByText('清单来源：', { exact: false }).waitFor();
    if (state === 3) {
      await deletion.getByText('有 2 个任务在用这一版，删不了', { exact: true }).waitFor();
      assert.equal(
        await deletion.getByRole('button', { name: '删除镜像', exact: true }).isDisabled(),
        true,
      );
    } else
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="image-delete-confirm"] button:last-child')
            ?.disabled === false,
      );
    return;
  }
  if (group === 'f-img-version') {
    await current.first().waitFor();
    if (state === 1) {
      await current.first().getByRole('button', { name: '检查更新', exact: true }).click();
      await page.getByTestId('upstream-digest').waitFor();
      return;
    }
    if (state === 2) {
      await current.first().getByRole('button', { name: '重新验证', exact: true }).click();
      await current.first().getByRole('button', { name: '重新验证中…', exact: true }).waitFor();
      return;
    }
    if (state === 3) {
      await current.first().getByRole('button', { name: '展开全串', exact: true }).click();
      assert.equal(
        await current
          .first()
          .getByRole('button', { name: '收起', exact: true })
          .getAttribute('aria-expanded'),
        'true',
      );
      return;
    }
    const switchVersion = current
      .first()
      .locator('..')
      .getByRole('button', { name: '切换到此版本', exact: true })
      .first();
    await switchVersion.click();
    await page.getByText('已切换到该版本。', { exact: true }).waitFor();
    return;
  }
  if (group === 'f-img-preset') {
    const download = page.getByRole('region', { name: '下载到本机', exact: true });
    await download.waitFor();
    await download.getByRole('button', { name: '准备镜像', exact: true }).click();
    await download
      .getByText(state === 3 ? /校验 sha256 对不上/ : state === 2 ? /进度未知/ : /37%/)
      .first()
      .waitFor();
    return;
  }
  if (group === 'f-sys-resource') {
    await (
      state === 1
        ? page.getByTestId('resources-skeleton')
        : page.getByText(`还能再发 ${state === 3 ? 0 : state === 2 ? 1 : 3} 个任务`, {
            exact: true,
          })
    ).waitFor();
    return;
  }
  if (group === 'f-sys-conn') {
    if (state === 3) {
      await page.getByRole('alert').filter({ hasText: '本机资源读取失败' }).waitFor();
      const providerCard = page.locator('section[aria-labelledby="sandbox-env-status-heading"]');
      await providerCard.getByRole('alert').filter({ hasText: '沙箱环境概览读取失败' }).waitFor();
      assert.equal(await providerCard.getAttribute('aria-busy'), 'false');
      assert.equal(await providerCard.locator('.animate-pulse').count(), 0);
      assert.equal(await providerCard.getByText('健康统计窗口', { exact: false }).count(), 0);
      return;
    }
    await page.getByRole('heading', { name: '沙箱环境状态', exact: true }).waitFor();
    if (state === 1) {
      await page.getByRole('button', { name: '查看日志', exact: true }).click();
      await page.getByText(/aio create container failed/).waitFor();
      return;
    }
    await page
      .getByRole('textbox', { name: state === 2 ? 'HTTPS_PROXY' : 'HTTP_PROXY', exact: true })
      .fill(state === 2 ? 'socks5://localhost:7890' : 'http://localhost:7890');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page
      .getByText(state === 2 ? /代理地址格式不对/ : /已保存。下一轮联网检查/)
      .first()
      .waitFor();
    return;
  }
  if (group === 'f-sys-diag') {
    await page.getByRole('button', { name: '重新诊断', exact: true }).click();
    if (state === 1) {
      await page.getByText('正在连接诊断流…（检查清单由服务端下发）', { exact: true }).waitFor();
      assert.equal(
        await page.getByRole('button', { name: '诊断中…', exact: true }).isDisabled(),
        true,
      );
      return;
    }
    await page.getByText('帐号登录环境', { exact: true }).waitFor();
    if (state === 2) {
      await page.getByRole('button', { name: '诊断中…', exact: true }).waitFor();
      return;
    }
    if (state === 3) {
      await page.getByTestId('diagnose-aborted').waitFor();
      assert.equal(await page.getByText('未返回', { exact: true }).count(), 4);
      return;
    }
    await page.getByTestId('diagnose-summary').waitFor();
    if (state === 4) {
      await page.getByText('超时未响应', { exact: true }).waitFor();
      assert.equal(await page.getByTestId('diagnose-summary').getAttribute('role'), 'status');
    }
    return;
  }
  if (group === 'f-sys-audit') {
    if (state === 1) {
      await page.getByText('暂无记录', { exact: true }).waitFor();
      return;
    }
    if (state === 2 || state === 3) {
      await page
        .getByRole('combobox', { name: '类别', exact: true })
        .selectOption(state === 3 ? 'credential' : 'sandbox');
      await page.getByText('当前筛选无匹配记录', { exact: true }).waitFor();
      return;
    }
    if (state === 4) {
      await page.getByTestId('audit-row-100').waitFor();
      await page.clock.fastForward(31000);
      await page.getByText(/实时更新已中断/).waitFor();
      assert.equal(await page.getByTestId('audit-row-100').count(), 1);
      return;
    }
    if (state === 5) {
      await page.getByLabel('起始时间', { exact: true }).fill('2026-10-02T15:00');
      await page.getByText('当前筛选无匹配记录', { exact: true }).waitFor();
      return;
    }
    await page
      .getByTestId('audit-row-100')
      .getByRole('button', { name: '查看该任务完整时间线', exact: true })
      .click();
    await page.getByText('任务：迁移构建脚本', { exact: true }).waitFor();
    assert.equal(
      await page.getByRole('button', { name: '查看该任务完整时间线', exact: true }).count(),
      0,
    );
    return;
  }
  if (group === 'f-aut-rules') {
    if (page.viewportSize().width < 640) {
      await page.locator('[data-project-menu-trigger="project-a"]').waitFor({ state: 'attached' });
      await page.locator('[data-command-trigger]').focus();
      await page.keyboard.press('Meta+k');
      await page
        .getByRole('combobox', { name: '查找任务、项目与动作', exact: true })
        .fill('自动化');
      await page.getByRole('option').filter({ hasText: '自动化规则 · acme-web' }).click();
    } else {
      await page.locator('[data-project-menu-trigger="project-a"]').click();
      await page.getByRole('menuitem', { name: '自动化规则', exact: true }).click();
    }
    const modal = page.getByTestId('automations-modal');
    await modal.waitFor();
    if ([1, 2, 3, 13].includes(state)) {
      await (
        state === 13
          ? page.getByTestId('automation-load-error')
          : state === 3
            ? page.getByTestId('automation-empty')
            : page.getByTestId('automation-list-item').first()
      ).waitFor();
      if (state === 2) assert.equal(await page.getByTestId('automation-create').isDisabled(), true);
      return;
    }
    if ([4, 6].includes(state)) {
      await page.getByTestId('automation-create').click();
      await page.getByTestId('automation-form').waitFor();
      if (state === 6) {
        const name = page.getByTestId('form-name');
        await name.fill('长'.repeat(61));
        await name.press('Tab');
        await page.getByTestId('form-name-error').waitFor();
        await name.fill('回归');
        await page.getByTestId('form-runtime').selectOption('codex');
        await page.getByTestId('form-prompt').fill('运行测试');
        await page.getByTestId('form-save').click();
        await page.getByTestId('form-save-error').waitFor();
      }
      return;
    }
    await page.getByTestId('automation-select').first().click();
    await page.getByTestId('automation-detail').waitFor();
    if (state === 5) {
      await page.getByTestId('detail-edit').click();
      await page.getByTestId('schedule-timezone').fill('UTC');
      await page.getByTestId('webhook-enabled').check();
      await page.getByTestId('webhook-url').fill('https://example.test/hook');
      await page.getByTestId('webhook-test').click();
      await page.getByTestId('webhook-section').getByRole('alert').waitFor();
      return;
    }
    if (state === 8) {
      await page.getByTestId('run-toggle-detail').first().click();
      await page.getByTestId('run-error-message').waitFor();
      return;
    }
    if (state === 9) {
      await page.getByTestId('detail-delete').click();
      await page.getByTestId('detail-delete-confirm-no').waitFor();
      return;
    }
    if (state === 10) await page.getByTestId('run-history-empty').waitFor();
    else if (state === 11) await page.getByTestId('run-history-error').waitFor();
    else await page.getByTestId('run-history-item').first().waitFor();
    return;
  }
  throw new Error(`Frame has no production exercise: ${id}`);
}
try {
  for (const theme of ['dark', 'light'])
    for (const width of [1440, 1024, 390]) {
      if (selectedScenario && selectedScenario !== `${theme}:${width}`) continue;
      for (const frame of frames) {
        if (selectedDomain && !frame.id.startsWith(`f-${selectedDomain.toLowerCase()}-`)) continue;
        if (selectedFrame && selectedFrame !== frame.id) continue;
        const fixture = configure(frame.id);
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        page.setDefaultTimeout(12000);
        const result = {
          draftId: frame.id,
          source: frame.source,
          theme,
          width,
          status: 'running',
          errors: [],
          screenshots: [],
          requests: [],
          mutations: fixture.mutations,
        };
        results.push(result);
        page.on('pageerror', (error) => result.errors.push(error.message));
        await page.clock.install({ time: new Date('2026-10-05T00:00:00Z') });
        await page.addInitScript(
          ({ theme, diagnosis, provision }) => {
            localStorage.setItem(
              'agent-platform-ui',
              JSON.stringify({
                state: {
                  theme,
                  selectedProjectId: 'project-a',
                  selectedSandboxId: null,
                  sidebarCollapsed: false,
                  bannerDismissedToday: {},
                },
                version: 0,
              }),
            );
            const original = window.fetch;
            window.fetch = async (...args) => {
              const url = new URL(
                typeof args[0] === 'string'
                  ? args[0]
                  : args[0] instanceof Request
                    ? args[0].url
                    : String(args[0]),
                location.href,
              );
              const plan =
                url.pathname === '/api/system/diagnose'
                  ? diagnosis
                  : url.pathname === '/api/system/preset-image/provision'
                    ? provision
                    : null;
              if (!plan) return original(...args);
              const encoder = new TextEncoder();
              const stream = new ReadableStream({
                start(controller) {
                  for (const frame of plan.frames)
                    controller.enqueue(
                      encoder.encode(`event: ${frame.event}\ndata: ${JSON.stringify(frame)}\n\n`),
                    );
                  if (!plan.hold) controller.close();
                  const signal = args[1]?.signal;
                  if (signal)
                    signal.addEventListener(
                      'abort',
                      () => {
                        try {
                          controller.error(new DOMException('Aborted', 'AbortError'));
                        } catch {
                          /* An aborted fixture may already be closed. */
                        }
                      },
                      { once: true },
                    );
                },
              });
              return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
            };
          },
          { theme, diagnosis: fixture.stream('diagnose'), provision: fixture.stream('provision') },
        );
        const pendingReads = [];
        await page.route('**/api/**', async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          const method = request.method();
          result.requests.push({ method, path: url.pathname, query: url.search });
          const response =
            method === 'GET'
              ? fixture.get(url.pathname, url.searchParams)
              : fixture.mutate(
                  method,
                  url.pathname,
                  request.postData() ? request.postDataJSON() : null,
                );
          if (response?.delay) {
            pendingReads.push({ route, path: url.pathname, query: url.searchParams });
            return;
          }
          if (response?.error) {
            if (response.error === 405)
              result.errors.push(`Unsupported fixture mutation ${method} ${url.pathname}`);
            await route.fulfill({
              status: response.error,
              json: {
                code: response.code ?? 'INTERNAL',
                message: '夹具模拟真实来源失败',
                retryable: response.error >= 500,
                ...(response.details ? { details: response.details } : {}),
              },
            });
            return;
          }
          await route.fulfill({ json: response });
        });
        await page.routeWebSocket(/socket\.io/, (socket) => socket.close());
        try {
          await page.goto(`${origin}${frame.route}`, { waitUntil: 'domcontentloaded' });
          await exercise(page, fixture);
          await page.evaluate(() => document.fonts.ready);
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
            `${frame.id}: no page overflow`,
          );
          const screenshot = `${frame.id}-${theme}-${width}.png`;
          await page.screenshot({
            path: resolve(output, screenshot),
            animations: 'disabled',
            fullPage: true,
          });
          result.screenshots.push(screenshot);
          if (frame.id === 'f-sys-resource-01') {
            const selectors = [
              'section[aria-labelledby="resource-pool-heading"]',
              'section[aria-labelledby="sandbox-env-status-heading"]',
            ];
            const before = await Promise.all(
              selectors.map((selector) =>
                page
                  .locator(selector)
                  .evaluate((element) => element.getBoundingClientRect().height),
              ),
            );
            const data = configure('f-sys-conn-04');
            for (const pending of pendingReads)
              await pending.route.fulfill({ json: data.get(pending.path, pending.query) });
            await page.getByText('还能再发 3 个任务', { exact: true }).waitFor();
            await page.getByTestId('sandbox-env-row-aio').waitFor();
            const after = await Promise.all(
              selectors.map((selector) =>
                page
                  .locator(selector)
                  .evaluate((element) => element.getBoundingClientRect().height),
              ),
            );
            result.cardHeights = { before, after };
            assert.ok(
              before.every((height, index) => Math.abs(height - after[index]) <= 20),
              'SYS070.2: skeleton to current data changes each card by at most one line',
            );
          }
          if (frame.id === 'f-aut-rules-01') {
            await page.keyboard.press('Escape');
            await page.getByTestId('automations-modal').waitFor({ state: 'detached' });
            await page.waitForFunction(
              (selector) => document.querySelector(selector) === document.activeElement,
              width >= 640 ? '[data-project-menu-trigger="project-a"]' : '[data-command-trigger]',
            );
          }
          if (frame.id === 'f-aut-rules-05') {
            await page.setViewportSize({ width, height: 560 });
            const form = page.getByTestId('automation-form');
            await form
              .locator('[class*="overflow-y-auto"]')
              .first()
              .evaluate((element) => {
                element.scrollTop = element.scrollHeight;
              });
            const save = await page.getByTestId('form-save').boundingBox();
            const close = await page
              .getByTestId('automations-modal')
              .getByRole('button', { name: '关闭', exact: true })
              .boundingBox();
            assert.ok(
              save && close && save.y + save.height <= 560 && close.y >= 0,
              'Form header and footer remain visible in short viewport',
            );
          }
          assert.deepEqual(result.errors, []);
          result.status =
            frame.id === 'f-sys-audit-03' ? 'not-applicable-current-emission' : 'passed';
        } catch (error) {
          result.status = 'failed';
          result.error = error.message;
          const screenshot = `${frame.id}-${theme}-${width}-failed.png`;
          await page
            .screenshot({
              path: resolve(output, screenshot),
              animations: 'disabled',
              fullPage: true,
            })
            .catch(() => {
              /* Closing the page can prevent a failure screenshot. */
            });
          result.screenshots.push(screenshot);
        } finally {
          await page.close();
          const record = manifest.frames.find((entry) => entry.draftId === frame.id);
          const evidence = {
            theme,
            width,
            status: result.status,
            screenshot: relative(repositoryRoot, resolve(output, result.screenshots[0])),
            variantScreenshots: result.screenshots
              .slice(1)
              .map((path) => relative(repositoryRoot, resolve(output, path))),
            review: relative(repositoryRoot, resolve(output, 'review.json')),
            ...(result.cardHeights ? { cardHeights: result.cardHeights } : {}),
          };
          record.evidence = record.evidence.filter(
            (entry) => entry.theme !== theme || entry.width !== width,
          );
          record.evidence.push(evidence);
          const combinations = new Set(
            record.evidence.map((entry) => `${entry.theme}:${entry.width}`),
          );
          record.verificationStatus = record.evidence.some((entry) => entry.status === 'failed')
            ? 'browser-failed'
            : frame.id === 'f-sys-audit-03'
              ? 'not-applicable-current-emission'
              : combinations.size === 6 &&
                  record.evidence.every((entry) => entry.status === 'passed')
                ? 'browser-passed'
                : 'partially-executed';
          await saveManifest();
          await writeFile(
            resolve(output, 'review.json'),
            `${JSON.stringify({ origin, frames: 55, execution: 'actual production browser with isolated HTTP/SSE fixtures', results }, null, 2)}\n`,
          );
        }
      }
    }
} finally {
  await browser.close();
}
console.log(
  JSON.stringify({
    passed: results.filter((x) => x.status === 'passed').length,
    failed: results.filter((x) => x.status === 'failed').length,
    notApplicable: results.filter((x) => x.status === 'not-applicable-current-emission').length,
    output,
  }),
);
if (results.some((x) => x.status === 'failed')) process.exitCode = 1;
