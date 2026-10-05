import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Every API request and websocket is intercepted. Mutations change only this script's fixtures.
const origin = process.argv[2] ?? 'http://localhost:3100';
// Optional fast reproduction, for example DESIGN_REVIEW_SCENARIO=dark:1440.
const scenario = process.env['DESIGN_REVIEW_SCENARIO'];
assert.ok(
  scenario === undefined || /^(dark|light):(1440|1024|390)$/.test(scenario),
  'DESIGN_REVIEW_SCENARIO must be theme:width from the existing six scenarios',
);
const output = resolve(
  process.argv[3] ?? fileURLToPath(new URL('../../artifacts/design-image-v2/', import.meta.url)),
);
const now = '2026-10-05T00:00:00.000Z';
const oldDigest = `sha256:${'a'.repeat(64)}`;
const newDigest = `sha256:${'b'.repeat(64)}`;
const projects = [
  {
    id: 'review-web',
    name: '示例 Web 项目',
    sourceType: 'empty',
    cloneStatus: 'ready',
    cloneErrorCode: null,
    taskCount: 0,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'review-api',
    name: '示例 API 项目',
    sourceType: 'empty',
    cloneStatus: 'ready',
    cloneErrorCode: null,
    taskCount: 1,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'review-cloning',
    name: '同步中的项目',
    sourceType: 'git',
    cloneStatus: 'cloning',
    cloneErrorCode: null,
    taskCount: 0,
    createdAt: now,
    updatedAt: now,
  },
];
const provider = {
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
function manifest(overrides = {}) {
  return {
    id: 'custom-current',
    imageId: 'custom-image',
    imageName: 'docker.io/acme/ml-agent',
    isBuiltin: false,
    ref: 'docker.io/acme/ml-agent:v2',
    version: 'v2',
    baseImage: 'docker.io/acme/ml-agent',
    digest: newDigest,
    entrypointContract: { workdir: '/workspace', entrypoint: ['/bin/sh'] },
    supportedRuntimes: [],
    resourceDefaults: { cores: 2, ramMb: 2048, diskMb: 10240 },
    labelsRequired: [],
    validationStatus: 'warning',
    validationErrors: [
      { code: 'RUNTIME_NOT_PREINSTALLED', message: '没有预装 Codex，启动会明显变慢' },
    ],
    isActive: true,
    imageConfig: null,
    derivedFromDigest: oldDigest,
    registeredAt: now,
    resolvedAt: now,
    providerCompatibility: { aio: true },
    isProviderDefault: false,
    ...overrides,
  };
}
const failedTask = {
  id: 'review-failed-task',
  projectId: 'review-api',
  runtime: 'codex',
  availableRuntimes: ['codex'],
  provider: 'aio',
  name: '迁移构建脚本',
  status: 'failed',
  failureCode: 'IMAGE_PULL_FAILED',
  failureMessage: 'registry did not respond',
  headless: false,
  timeoutMinutes: null,
  idleTimeoutSec: 1800,
  waitingInput: false,
  version: 1,
  image: 'docker.io/acme/ml-agent:v1',
  imageId: 'custom-old',
  imageDigest: oldDigest,
  imageIsBuiltin: false,
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
  retainedVolumes: { count: 0, totalBytes: 0, percentOfDisk: 0, level: 'ok', truncated: false },
  activeTasks: 0,
};

function imageList(presetActive) {
  return [
    manifest({
      id: 'preset-current',
      imageId: 'preset-image',
      imageName: 'ghcr.io/agent-infra/sandbox',
      ref: 'ghcr.io/agent-infra/sandbox:latest',
      version: 'latest',
      isBuiltin: true,
      isProviderDefault: true,
      validationStatus: 'valid',
      validationErrors: null,
      supportedRuntimes: ['codex'],
      isActive: presetActive,
      derivedFromDigest: null,
    }),
    manifest({
      id: 'custom-old',
      ref: 'docker.io/acme/ml-agent:v1',
      version: 'v1',
      digest: oldDigest,
      isActive: false,
      registeredAt: '2026-10-01T00:00:00.000Z',
    }),
    manifest(),
    manifest({
      id: 'invalid-current',
      imageId: 'invalid-image',
      imageName: 'docker.io/acme/invalid',
      ref: 'docker.io/acme/invalid:v1',
      validationStatus: 'invalid',
      validationErrors: [{ code: 'INVALID_CONTRACT', message: '不符合平台约定' }],
    }),
    manifest({
      id: 'incompatible-current',
      imageId: 'incompatible-image',
      imageName: 'docker.io/acme/other-provider',
      ref: 'docker.io/acme/other-provider:v1',
      providerCompatibility: { aio: false },
    }),
  ];
}
async function checkLayout(page, result, screenName) {
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    dialogCount: document.querySelectorAll('[role="dialog"]').length,
    imageCards: document.querySelectorAll('[data-testid="image-card"]').length,
  }));
  assert.equal(metrics.horizontalOverflow, false, `${screenName} must not overflow horizontally`);
  result.layout[screenName] = metrics;
  const filename = `${screenName}-${result.theme}-${result.width}.png`;
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.screenshot({
    path: `${output}/${filename}`,
    fullPage: screenName !== 'new-task-short-viewport',
    animations: 'disabled',
  });
  result.screenshots.push(filename);
}
async function selectPersistedTask(page) {
  await page.evaluate((task) => {
    const persisted = JSON.parse(
      localStorage.getItem('agent-platform-ui') ?? '{"state":{},"version":0}',
    );
    persisted.state.selectedProjectId = task.projectId;
    persisted.state.selectedSandboxId = task.id;
    persisted.state.selectedSandboxTerminalAt = null;
    localStorage.setItem('agent-platform-ui', JSON.stringify(persisted));
  }, failedTask);
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
try {
  for (const theme of ['dark', 'light']) {
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
        layout: {},
        errors: [],
        mutations: [],
      };
      results.push(result);
      let presetActive = false;
      let presetReady = false;
      let validationCalls = 0;
      let tasks = [{ ...failedTask }];
      page.on('pageerror', (error) => result.errors.push(error.message));
      try {
        await page.addInitScript((theme) => {
          if (localStorage.getItem('agent-platform-ui') !== null) return;
          localStorage.setItem(
            'agent-platform-ui',
            JSON.stringify({
              state: {
                theme,
                sidebarCollapsed: false,
                selectedProjectId: null,
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
          if (request.method() === 'POST' && path === '/api/system/diagnose') {
            const frames = [
              {
                event: 'start',
                checks: [{ id: 'preset-image', label: '预制镜像就绪' }],
                timeoutMs: 10_000,
              },
              {
                event: 'check',
                id: 'preset-image',
                label: '预制镜像就绪',
                status: presetReady ? 'ok' : 'info',
                step: 'staged',
                headline: presetReady ? '预制镜像就绪，可以立即发起任务' : '镜像还没下载到本机',
                durationMs: 1,
                detail: {
                  ref: 'ghcr.io/agent-infra/sandbox:latest',
                  ...(presetReady
                    ? {}
                    : {
                        provision: {
                          provisionable: true,
                          from: 'ghcr.io/agent-infra/sandbox:latest',
                          to: '本机镜像库',
                          sizeBytes: null,
                          why: '可提前下载',
                        },
                      }),
                },
              },
              {
                event: 'done',
                okCount: presetReady ? 1 : 0,
                infoCount: presetReady ? 0 : 1,
                warnCount: 0,
                failCount: 0,
                totalMs: 2,
              },
            ];
            await route.fulfill({
              contentType: 'text/event-stream',
              body: frames
                .map((frame) => `event: ${frame.event}\ndata: ${JSON.stringify(frame)}\n\n`)
                .join(''),
            });
            return;
          }
          if (request.method() === 'POST' && path === '/api/system/preset-image/provision') {
            presetReady = true;
            result.mutations.push({
              method: 'POST',
              path,
              input: request.postData() ? request.postDataJSON() : null,
            });
            await route.fulfill({
              contentType: 'text/event-stream',
              body: 'event: done\ndata: {"event":"done","ok":true}\n\n',
            });
            return;
          }
          if (request.method() === 'POST' && path === '/api/images/validate') {
            validationCalls += 1;
            await route.fulfill(
              validationCalls === 1
                ? {
                    status: 502,
                    json: {
                      code: 'REGISTRY_UNREACHABLE',
                      message: 'fixture registry connection failure',
                      retryable: true,
                    },
                  }
                : {
                    json: {
                      status: 'warning',
                      digest: newDigest,
                      errors: [],
                      warnings: [
                        {
                          code: 'RUNTIME_NOT_PREINSTALLED',
                          message: "未声明 'claude-code' runtime 数分钟",
                        },
                      ],
                    },
                  },
            );
            return;
          }
          if (request.method() === 'POST' && path === '/api/images') {
            result.mutations.push({ method: 'POST', path, input: request.postDataJSON() });
            await route.fulfill({
              status: 200,
              json: {
                manifest: imageList(presetActive).find((image) => image.id === 'custom-current'),
                validation: { status: 'warning', errors: [], warnings: [] },
              },
            });
            return;
          }
          if (request.method() === 'POST' && path === '/api/sandboxes') {
            const input = request.postDataJSON();
            result.mutations.push({ method: 'POST', path, input });
            const created = {
              ...failedTask,
              id: 'review-created-task',
              projectId: input.projectId,
              name: '整理发布流程',
              status: 'pending',
              failureCode: undefined,
              failureMessage: undefined,
              image: 'docker.io/acme/ml-agent:v2',
              imageId: 'custom-current',
              imageDigest: newDigest,
              version: 0,
            };
            tasks = [...tasks, created];
            await route.fulfill({ status: 201, json: created });
            return;
          }
          if (request.method() === 'PATCH' && path === '/api/images/preset-current') {
            const input = request.postDataJSON();
            assert.deepEqual(input, { isActive: false });
            result.mutations.push({ method: 'PATCH', path, input });
            presetActive = false;
            await route.fulfill({ json: imageList(presetActive)[0] });
            return;
          }
          if (request.method() !== 'GET') {
            result.errors.push(`Unexpected mutation: ${request.method()} ${path}`);
            await route.fulfill({
              status: 405,
              json: {
                code: 'REVIEW_ONLY',
                message: 'Unsupported fixture request',
                retryable: false,
              },
            });
            return;
          }
          let json = [];
          if (path === '/api/system/init-status') json = { initialized: true, initializedAt: now };
          else if (path === '/api/health') json = { status: 'ok' };
          else if (path === '/api/projects') json = projects;
          else if (path === '/api/providers') json = [provider];
          else if (path === '/api/runtimes') json = runtimes;
          else if (path === '/api/images') json = imageList(presetActive);
          else if (/^\/api\/images\/[^/]+\/deletion-preview$/.test(path))
            json = {
              canDelete: false,
              tasks: [
                {
                  id: 'review-failed-task',
                  name: '迁移构建脚本',
                  projectId: 'review-api',
                  projectName: '示例 API 项目',
                  status: 'failed',
                },
              ],
              versions: imageList(presetActive)
                .filter((image) => image.imageId === 'custom-image')
                .map(({ id, version, digest, isActive }) => ({ id, version, digest, isActive })),
            };
          else if (path === '/api/sandboxes')
            json = url.searchParams.has('projectId')
              ? tasks.filter((task) => task.projectId === url.searchParams.get('projectId'))
              : tasks;
          else if (/^\/api\/sandboxes\/[^/]+$/.test(path))
            json = tasks.find((task) => task.id === path.split('/').at(-1));
          else if (path === '/api/system/resources') json = resources;
          else if (path === '/api/system/providers')
            json = {
              providers: [],
              runtimes: [],
              imageSpecs: [],
              healthWindowMs: 3_600_000,
              healthWarnRate: 0.01,
              healthErrorRate: 0.1,
            };
          else if (path === '/api/system/settings') json = {};
          else if (path === '/api/system/version')
            json = { version: '0.2.4', commit: 'fixture-review', builtAt: now };
          else if (path === '/api/system/audit') json = { items: [], hasMore: false };
          await route.fulfill({ json });
        });
        await page.routeWebSocket(/socket\.io/, (socket) => socket.close());
        await page.goto(origin);
        await page.getByRole('navigation', { name: '主导航' }).waitFor();
        const newTaskEntry = page.getByTestId('new-task-entry');
        await newTaskEntry.waitFor();
        await page.waitForFunction(
          (button) => !button.disabled,
          await newTaskEntry.elementHandle(),
        );
        await newTaskEntry.click();
        const modal = page.getByTestId('modal-new-task');
        await modal.waitFor();
        const projectSelect = modal.getByLabel('项目', { exact: true });
        assert.equal(
          await projectSelect.inputValue(),
          '',
          'Overview opens with no preselected project',
        );
        assert.equal(
          await projectSelect.locator('option[value="review-cloning"]').isDisabled(),
          true,
        );
        await modal.getByRole('radio', { name: /Codex/ }).check();
        const create = modal.getByRole('button', { name: '发起任务并打开终端', exact: true });
        assert.equal(await create.isDisabled(), true);
        await projectSelect.selectOption('review-api');
        await modal
          .getByText(
            '平台预制镜像已禁用，新任务用不了它：改选一张镜像，或到「镜像管理」重新启用它。',
            { exact: true },
          )
          .waitFor();
        assert.equal(
          await create.isDisabled(),
          true,
          'Disabled preset must block before submission',
        );
        result.checks.overviewProjectAndDefaultImageGate = true;
        await checkLayout(page, result, 'new-task-disabled-preset');

        const imageSelect = modal.getByLabel('镜像（可选）');
        assert.equal(await imageSelect.locator('option[value="invalid-image"]').isDisabled(), true);
        assert.equal(await imageSelect.locator('option[value="incompatible-image"]').count(), 0);
        await imageSelect.selectOption('custom-image');
        await modal.getByText('没有预装 Codex，启动会明显变慢。', { exact: true }).waitFor();
        assert.equal(await create.isEnabled(), true);
        await modal.getByLabel('任务指令（可选）').fill('整理发布流程');
        result.checks.customImageWarningAndOptions = true;
        await checkLayout(page, result, 'new-task-custom-image');
        if (width === 390) {
          await page.setViewportSize({ width, height: 520 });
          const footer = await modal.getByTestId('new-sandbox-panel').evaluate((panel) => {
            const body = panel.firstElementChild;
            const actions = panel.lastElementChild;
            const cancel = [...actions.querySelectorAll('button')].find(
              (button) => button.textContent.trim() === '取消',
            );
            const primary = actions.querySelector('button:last-child');
            const before = primary.getBoundingClientRect();
            body.scrollTop = 0;
            const atStart = primary.getBoundingClientRect();
            body.scrollTop = body.scrollHeight;
            const atEnd = primary.getBoundingClientRect();
            return {
              bodyScrollable: body.scrollHeight > body.clientHeight,
              bodyScrollTop: body.scrollTop,
              visible: before.top >= 0 && before.bottom <= innerHeight,
              cancelLeft: cancel.getBoundingClientRect().left < before.left,
              stable: atStart.top === atEnd.top && atStart.bottom === atEnd.bottom,
            };
          });
          assert.equal(footer.bodyScrollable, true);
          assert.ok(footer.bodyScrollTop > 0);
          assert.equal(footer.visible, true);
          assert.equal(footer.cancelLeft, true);
          assert.equal(footer.stable, true);
          result.checks.shortViewportFixedFooter = footer;
          await checkLayout(page, result, 'new-task-short-viewport');
          await page.setViewportSize({ width, height: 900 });
        }
        await create.click();
        await modal.waitFor({ state: 'detached' });
        await page.getByTestId('sandbox-startup-progress').waitFor();
        await page.getByText('镜像：docker.io/acme/ml-agent:v2', { exact: true }).waitFor();
        assert.equal(result.mutations[0].input.image, 'docker.io/acme/ml-agent:v2');
        assert.equal(result.mutations[0].input.projectId, 'review-api');
        assert.equal(Object.hasOwn(result.mutations[0].input, 'branch'), false);
        result.checks.submittedCurrentReferenceAndStartupSnapshot = true;
        await checkLayout(page, result, 'startup-image');

        await selectPersistedTask(page);
        await page.goto(origin);
        await page.getByTestId('sandbox-outcome').waitFor();
        await page.getByText('镜像：docker.io/acme/ml-agent:v1', { exact: true }).waitFor();
        const diagnostic = await page
          .getByTestId('copy-diagnostics')
          .getAttribute('data-diagnostic-text');
        assert.ok(diagnostic.includes(`镜像：docker.io/acme/ml-agent:v1@${oldDigest}`));
        result.checks.failureLockedSnapshotAndDiagnostics = true;
        await checkLayout(page, result, 'failure-image');
        await page.getByRole('button', { name: '检查镜像地址', exact: true }).click();
        await page.waitForURL((url) => url.pathname === '/settings/images');
        result.taskImageNavigationUrl = page.url();
        const source = page.getByRole('region', { name: '任务来源提示' });
        await source.waitFor();
        const highlighted = page
          .getByTestId('image-card-slot')
          .filter({ has: page.getByText('「迁移构建脚本」用的镜像', { exact: true }) });
        await highlighted.waitFor();
        assert.equal(await highlighted.getAttribute('data-highlighted'), 'true');
        await page.waitForFunction(
          (card) => document.activeElement === card,
          await highlighted.elementHandle(),
        );
        assert.ok((await highlighted.innerText()).includes('docker.io/acme/ml-agent:v2'));
        assert.equal(
          await highlighted.getByTestId('image-card').getAttribute('data-image-id'),
          'custom-current',
        );
        result.checks.originalManifestLocatesCurrentCardAndFocus = true;
        await checkLayout(page, result, 'image-task-source');
        await page.getByRole('button', { name: '关闭来源提示', exact: true }).click();
        await source.waitFor({ state: 'detached' });
        assert.equal(
          await page.locator('[data-testid="image-card-slot"][data-highlighted="true"]').count(),
          0,
        );
        assert.equal(new URL(page.url()).searchParams.has('fromTask'), false);
        result.checks.taskSourceDismissesWithoutPersistence = true;

        presetActive = true;
        await page.reload();
        const actualPreset = page.locator(
          '[data-testid="image-card"][data-image-id="preset-current"]',
        );
        await actualPreset.waitFor();
        await actualPreset.getByRole('button', { name: '禁用', exact: true }).click();
        const confirmation = page.getByRole('dialog', {
          name: '禁用预制镜像「ghcr.io/agent-infra/sandbox:latest」？',
          exact: true,
        });
        await confirmation.waitFor();
        await page.waitForFunction(
          (button) => document.activeElement === button,
          await confirmation.getByRole('button', { name: '取消', exact: true }).elementHandle(),
        );
        assert.equal(result.mutations.filter((request) => request.method === 'PATCH').length, 0);
        await checkLayout(page, result, 'preset-disable-confirmation');
        await page.keyboard.press('Escape');
        await confirmation.waitFor({ state: 'detached' });
        assert.equal(result.mutations.filter((request) => request.method === 'PATCH').length, 0);
        await actualPreset.getByRole('button', { name: '禁用', exact: true }).click();
        await confirmation.getByRole('button', { name: '禁用', exact: true }).click();
        await confirmation.waitFor({ state: 'detached' });
        await actualPreset.getByTestId('enable-state').filter({ hasText: '已禁用' }).waitFor();
        assert.equal(result.mutations.filter((request) => request.method === 'PATCH').length, 1);
        result.checks.presetConfirmationCancelAndConfirm = true;
        await checkLayout(page, result, 'preset-disabled');
        const download = actualPreset.getByRole('region', { name: '下载到本机' });
        await download.waitFor();
        assert.equal(await download.innerText().then((text) => text.includes('0 MB')), false);
        await download.getByRole('button', { name: '准备镜像', exact: true }).click();
        await download.waitFor({ state: 'detached' });
        result.checks.preparationWaitsForRealRecheck = true;

        await page.getByRole('button', { name: '+ 注册新镜像', exact: true }).click();
        const register = page.getByRole('dialog', { name: '注册新镜像', exact: true });
        const uri = register.getByRole('textbox', { name: '镜像 URI', exact: true });
        await uri.fill('docker.io/acme/ml-agent:v2');
        await register.getByRole('button', { name: '验证', exact: true }).click();
        await register.getByText(/连不上镜像下载源/).waitFor();
        assert.equal(await uri.inputValue(), 'docker.io/acme/ml-agent:v2');
        await checkLayout(page, result, 'image-register-request-failure');
        await register.getByRole('button', { name: '重试', exact: true }).click();
        await register
          .getByText('未预装 claude-code，创建时需现装，启动会明显变慢', { exact: true })
          .waitFor();
        await register.getByRole('button', { name: '保存', exact: true }).click();
        await register.getByRole('button', { name: '定位到该镜像', exact: true }).waitFor();
        assert.equal(await register.getByTestId('duplicate-hint').getAttribute('role'), 'status');
        await register.getByRole('button', { name: '定位到该镜像', exact: true }).click();
        await register.waitFor({ state: 'detached' });
        const currentCard = page.locator(
          '[data-testid="image-card"][data-image-id="custom-current"]',
        );
        await currentCard.waitFor();
        const slot = currentCard.locator('..');
        await page.waitForFunction(
          (node) => document.activeElement === node,
          await slot.elementHandle(),
        );
        result.checks.registrationFailureRetryDigestDuplicateAndFocus = true;
        await currentCard.getByRole('button', { name: '展开全串', exact: true }).click();
        assert.equal(
          await currentCard
            .getByRole('button', { name: '收起', exact: true })
            .getAttribute('aria-expanded'),
          'true',
        );
        await currentCard.getByRole('button', { name: '编辑环境变量', exact: true }).click();
        assert.equal(
          await currentCard
            .getByRole('button', { name: '编辑环境变量', exact: true })
            .getAttribute('aria-expanded'),
          'true',
        );
        await checkLayout(page, result, 'image-digest-and-env');
        await currentCard.getByRole('button', { name: '取消', exact: true }).click();
        await currentCard.getByRole('button', { name: '删除', exact: true }).click();
        const deletion = page.getByTestId('image-delete-confirm');
        await deletion.getByText(/有 1 个任务在用这一版，删不了/).waitFor();
        await deletion.getByText('迁移构建脚本 · 示例 API 项目 · 异常', { exact: true }).waitFor();
        assert.equal(
          await deletion.getByRole('button', { name: '删除镜像', exact: true }).isDisabled(),
          true,
        );
        await checkLayout(page, result, 'image-delete-blocked');
        await deletion.getByRole('button', { name: '取消', exact: true }).click();
        await deletion.waitFor({ state: 'detached' });
        result.checks.realDeletePreviewBlocksWithoutDelete = true;
        assert.deepEqual(result.errors, [], 'No runtime errors or unplanned API writes');
        result.status = 'passed';
      } catch (error) {
        result.status = 'failed';
        result.failure = error instanceof Error ? error.message : String(error);
        await checkLayout(page, result, 'failure').catch((error) =>
          result.errors.push(`Capture: ${error.message}`),
        );
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
const failures = results.filter((result) => result.status !== 'passed');
if (failures.length > 0)
  throw new Error(`${failures.length} image review scenarios failed; see ${output}/review.json`);
