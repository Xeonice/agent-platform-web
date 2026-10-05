import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const origin = process.argv[2] ?? 'http://localhost:3100';
const output = resolve(process.argv[3] ?? '../artifacts/design-credentials-v2');
const filter = process.env.DESIGN_REVIEW_SCENARIO;
const draftFilter = process.env.DESIGN_REVIEW_DRAFT;
const now = new Date().toISOString();
const digest = `sha256:${'a'.repeat(64)}`;
const project = {
  id: 'review-web',
  name: 'acme-web',
  sourceType: 'git',
  repoUrl: 'https://github.com/acme/web.git',
  cloneStatus: 'ready',
  cloneErrorCode: null,
  taskCount: 0,
  createdAt: now,
  updatedAt: now,
};
const git = {
  id: 'review-token',
  kind: 'git',
  type: 'https-token',
  maskedIdentifier: 'ghp_…ab12',
  platform: 'github',
  allowedHosts: ['github.com'],
  createdAt: now,
  lastUsedAt: new Date(Date.now() - 7_200_000).toISOString(),
};
const ssh = {
  id: 'review-ssh',
  kind: 'git',
  type: 'ssh-key',
  maskedIdentifier: 'SHA256:review-public-fingerprint',
  allowedHosts: [],
  knownHosts: [
    {
      host: 'git.acme.example.com',
      keyType: 'ssh-ed25519',
      fingerprint: 'SHA256:review-host-fingerprint',
      firstSeenAt: now,
    },
  ],
  createdAt: now,
};
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
const image = {
  id: 'review-image',
  imageId: 'review-builtin',
  imageName: '平台预制镜像',
  isBuiltin: true,
  ref: 'ghcr.io/acme/agent-platform:aio-v0.2.4',
  version: 'aio-v0.2.4',
  baseImage: 'ubuntu:24.04',
  digest,
  entrypointContract: { workdir: '/workspace', entrypoint: ['/bin/sh'] },
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
};
function runtime(id, state = 'both') {
  const name = id === 'codex' ? 'Codex' : 'Claude Code';
  const credentials =
    state === 'none'
      ? []
      : [
          ...(state === 'key'
            ? []
            : [
                {
                  credentialId: `${id}-account`,
                  mode: 'account',
                  status: 'ok',
                  maskedIdentifier: 'a***@example.com',
                  expiresAt: new Date(Date.now() + 26 * 86400000).toISOString(),
                },
              ]),
          ...(state === 'account'
            ? []
            : [
                {
                  credentialId: `${id}-key`,
                  mode: 'api-key',
                  status: 'ok',
                  maskedIdentifier: 'sk-…f3a9',
                },
              ]),
        ];
  return {
    id,
    displayName: name,
    vendor: id === 'codex' ? 'OpenAI' : 'Anthropic',
    authMethods: [id === 'codex' ? 'oauth-device' : 'setup-token', 'api-key'],
    apiKeyPrefix: id === 'codex' ? 'sk-' : 'sk-ant-',
    credentialStatus: state === 'none' ? 'none' : 'active',
    activeAuthMethod: state === 'none' ? undefined : state === 'key' ? 'api-key' : 'account',
    maskedIdentifier: state === 'key' ? 'sk-…f3a9' : 'a***@example.com',
    credentials,
    pendingTeardownCount: 0,
  };
}
const plans = [
  ...Array.from({ length: 9 }, (_, i) => `f-auth-panel-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 5 }, (_, i) => `f-crd-git-${String(i + 1).padStart(2, '0')}`),
  'f-crd-mode-01',
  ...Array.from({ length: 5 }, (_, i) => `f-crd-page-${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 3 }, (_, i) => `f-crd-revoke-${String(i + 1).padStart(2, '0')}`),
  'f-acc-unlock-02',
  'f-acc-unlock-03',
];
async function install(page, id, theme) {
  const log = [];
  let runtimeRows = [runtime('codex'), runtime('claude-code')];
  let gitRows = [git];
  let unlocked = !id.startsWith('f-acc');
  let submitted = false;
  let previewFailure = id === 'f-crd-revoke-02';
  if (/f-auth-panel-0[1-7]/.test(id))
    runtimeRows = [runtime('codex', 'none'), runtime('claude-code', 'none')];
  if (id === 'f-auth-panel-08')
    runtimeRows = [runtime('codex', 'key'), runtime('claude-code', 'none')];
  if (id === 'f-auth-panel-09')
    runtimeRows = [runtime('codex', 'account'), runtime('claude-code', 'none')];
  if (id === 'f-crd-git-02' || id === 'f-crd-git-03') gitRows = [];
  if (id === 'f-crd-git-04') gitRows = [git, ssh];
  if (id === 'f-crd-page-04') {
    runtimeRows[0].credentialStatus = 'expiring';
    runtimeRows[0].credentials[0].status = 'expiring';
    runtimeRows[0].credentials[0].expiresAt = new Date(
      Date.now() + 5 * 86400000 + 10000,
    ).toISOString();
    runtimeRows[1].credentialStatus = 'expired';
    runtimeRows[1].credentials[0].status = 'expired';
    runtimeRows[1].credentials[0].expiresAt = new Date(Date.now() - 10000).toISOString();
  }
  await page.addInitScript(
    ({ theme }) => {
      localStorage.clear();
      localStorage.setItem(
        'agent-platform-ui',
        JSON.stringify({ state: { theme, sidebarCollapsed: false }, version: 0 }),
      );
    },
    { theme },
  );
  await page.routeWebSocket(/.*/, (socket) => socket.close());
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname,
      method = request.method();
    log.push({ path, method });
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const denied = () =>
      json(
        { code: 'PASSCODE_REQUIRED', message: 'untrusted backend message', retryable: false },
        401,
      );
    if (path === '/api/access/unlock') {
      if (id === 'f-acc-unlock-03') await new Promise((resolve) => setTimeout(resolve, 500));
      if (id === 'f-acc-unlock-03')
        return json(
          {
            code: submitted ? 'PASSCODE_LOCKED' : 'PASSCODE_INVALID',
            message: 'untrusted backend message',
            retryable: submitted,
            retryAfterSec: submitted ? 300 : undefined,
          },
          submitted ? 429 : ((submitted = true), 401),
        );
      unlocked = true;
      return json({ unlocked: true });
    }
    if (!unlocked && path !== '/api/health') return denied();
    if (path === '/api/health') return json({ status: 'ok' });
    if (path === '/api/system/init-status') return json({ initialized: true, initializedAt: now });
    if (path === '/api/runtimes' || path === '/api/credentials') {
      if (id === 'f-crd-page-01') await new Promise((resolve) => setTimeout(resolve, 3000));
      if (id === 'f-crd-page-02')
        return json({ code: 'INTERNAL', message: '不可读', retryable: true }, 500);
      return json(path === '/api/runtimes' ? runtimeRows : gitRows);
    }
    if (path === '/api/projects')
      return json(
        id === 'f-crd-page-05'
          ? [{ ...project, cloneStatus: 'failed', cloneErrorCode: 'CLONE_FAILED_PERMISSION' }]
          : [project],
      );
    if (/\/projects\/[^/]+$/.test(path))
      return json(
        id === 'f-crd-page-05'
          ? { ...project, cloneStatus: 'failed', cloneErrorCode: 'CLONE_FAILED_PERMISSION' }
          : project,
      );
    if (path.endsWith('/branches')) return json(['main']);
    if (path.endsWith('/retry-clone')) return json({ ...project, cloneStatus: 'cloning' });
    if (path.endsWith('/deletion-preview') && path.includes('/credentials/')) {
      if (previewFailure) {
        previewFailure = false;
        return json({ code: 'INTERNAL', message: 'unavailable', retryable: true }, 500);
      }
      const affectedTasks =
        id === 'f-crd-revoke-03'
          ? []
          : [
              ['补 e2e 用例', 'waiting_input'],
              ['修一下登录态刷新', 'running'],
              ['整理发布说明', 'idle'],
              ['重构支付回调', 'waiting_input'],
              ['每天凌晨跑一遍回归 #12', 'running'],
            ].map(([name, status], index) => ({
              id: `live-${index}`,
              name,
              runtime: 'codex',
              status,
              headless: index === 4,
            }));
      return json({
        affectedTasks,
        preparingTasks: [
          {
            id: 'prepare',
            name: '修一下首页加载慢',
            runtime: 'codex',
            status: 'creating',
            headless: false,
          },
        ],
      });
    }
    if (path.endsWith('/auth/begin')) {
      const rt = path.split('/')[3];
      return json({
        challengeRef: 'review-challenge',
        method: rt === 'codex' ? 'oauth-device' : 'setup-token',
        kind: rt === 'codex' ? 'device-code' : 'url',
        userCode: rt === 'codex' ? 'WDJB-MJHT' : undefined,
        verificationUrl: 'https://example.test/authorize',
        expiresAt: new Date(Date.now() + (id === 'f-auth-panel-04' ? 1500 : 900000)).toISOString(),
        instructions: '在浏览器完成授权。',
      });
    }
    if (path.endsWith('/auth/status')) return json({ status: 'pending' });
    if (path.endsWith('/auth/complete')) {
      if (id === 'f-auth-panel-05')
        return json(
          { code: 'AUTH_REJECTED', message: 'backend raw diagnostic forbidden', retryable: false },
          401,
        );
      const rt = path.split('/')[3];
      runtimeRows = runtimeRows.map((row) => (row.id === rt ? runtime(rt, 'account') : row));
      return json({ maskedIdentifier: 'sk-ant-oat01-…f3a9' });
    }
    if (path.endsWith('/credentials/secret'))
      return json(
        {
          code: 'AUTH_REJECTED',
          message: 'backend raw diagnostic forbidden',
          retryable: false,
          details: [{ message: '比正常的 key 短，可能只复制到了一部分。' }],
        },
        401,
      );
    if (path.endsWith('/credentials/status'))
      return json(runtimeRows.find((row) => row.id === path.split('/')[3]));
    if (path.includes('/auth/sessions/') && method === 'DELETE')
      return route.fulfill({ status: 204 });
    if (path.endsWith('/auth-mode'))
      return json({ runtimeId: 'codex', activeAuthMethod: 'api-key' });
    if (path === '/api/credentials/git/test')
      return json(
        id === 'f-crd-git-01'
          ? { ok: true, message: '连接成功' }
          : { ok: false, errorCode: 'AUTH_REJECTED', message: 'not for direct display' },
      );
    if (path === '/api/providers') return json([provider]);
    if (path === '/api/images') return json([image]);
    if (path === '/api/system/settings') return json({});
    if (path === '/api/system/resources')
      return json({
        cpu: { cores: 8, loadAvg1m: 0.5, usedPercent: 10, level: 'ok' },
        ram: { totalBytes: 32 * 1024 ** 3, usedBytes: 8 * 1024 ** 3, usedPercent: 25, level: 'ok' },
        disk: {
          path: '/data',
          totalBytes: 500 * 1024 ** 3,
          availableBytes: 300 * 1024 ** 3,
          usedBytes: 200 * 1024 ** 3,
          usedPercent: 40,
          reservedPercent: 10,
          level: 'ok',
        },
        retainedVolumes: {
          count: 0,
          totalBytes: 0,
          percentOfDisk: 0,
          level: 'ok',
          truncated: false,
        },
        activeTasks: 0,
        capacity: { remainingTasks: 8, registeredTasks: 0, maxTasks: 8, basis: '默认档' },
      });
    if (path === '/api/system/providers')
      return json({
        providers: [],
        runtimes: [],
        imageSpecs: [],
        healthWindowMs: 3600000,
        healthWarnRate: 0.01,
        healthErrorRate: 0.1,
      });
    if (path === '/api/system/version')
      return json({ version: '0.2.4', commit: 'review', builtAt: now });
    if (path === '/api/system/audit') return json({ items: [], hasMore: false });
    return json([]);
  });
  return log;
}
async function drive(page, id, theme, width) {
  const variants = [];
  const captureVariant = async (state) => {
    const screenshot = `${id}-${state}-${theme}-${width}.png`;
    await page.screenshot({ path: `${output}/${screenshot}`, fullPage: true });
    variants.push({ state, screenshot });
  };
  if (id.startsWith('f-acc')) {
    await page.goto(origin + '/settings/credentials');
    await page.getByRole('heading', { name: '需要访问口令' }).waitFor();
    assert.equal(await page.locator('#workbench-sidebar').count(), 0);
    if (id.endsWith('03')) {
      await page.locator('input[name="passcode"]').fill('synthetic-passcode');
      await page.getByRole('button', { name: '解锁', exact: true }).click();
      await page.getByRole('button', { name: '验证中…', exact: true }).waitFor();
      assert.equal(await page.locator('input[name="passcode"]').isDisabled(), true);
      await captureVariant('busy');
      await page.getByText('口令不对，再试一次。').waitFor();
      assert.equal(await page.locator('input[name="passcode"]').inputValue(), 'synthetic-passcode');
      await captureVariant('invalid');
      await page.getByRole('button', { name: '解锁', exact: true }).click();
      await page.getByText('错得太多次，已暂时锁定，约 5 分钟后再试。').waitFor();
      assert.equal(
        await page.getByRole('button', { name: '解锁', exact: true }).isDisabled(),
        true,
      );
      await captureVariant('locked');
    }
    return variants;
  }
  const taskAuth = /^f-auth-panel-0[1-7]$/.test(id);
  await page.goto(origin + (taskAuth ? '/' : '/settings/credentials'));
  if (taskAuth) {
    await page.getByRole('button', { name: '新任务', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建任务', exact: true });
    await dialog.waitFor();
    const rt = /0[34]$/.test(id) ? 'Codex' : 'Claude Code';
    await dialog.getByRole('radio', { name: new RegExp(rt) }).check();
    await dialog.getByLabel('任务指令（可选）').fill('迁移构建脚本，保留这句指令。');
    if (id.endsWith('01')) return;
    await dialog.getByRole('button', { name: '配置凭证', exact: true }).click();
    if (id.endsWith('02')) return;
    if (id.endsWith('06')) {
      await dialog.getByRole('tab', { name: 'API Key', exact: true }).click();
      await dialog.locator('input[name="api-key"]').fill('wrong-prefix');
      await dialog.getByRole('button', { name: '保存并继续' }).click();
      await dialog.getByText('这串 API Key 格式不对，没有保存。').waitFor();
      await dialog.locator('input[name="api-key"]').fill('wrong-prefix');
      return;
    }
    await dialog.getByRole('button', { name: '开始帐号登录' }).click();
    if (id.endsWith('03') || id.endsWith('04')) {
      await dialog.getByLabel('设备码').waitFor();
      if (id.endsWith('04')) await dialog.getByText('这串设备码已经到期了。').waitFor();
      return;
    }
    await dialog.locator('input[name="setup-token-code"]').fill('synthetic-code');
    await dialog.getByRole('button', { name: '提交', exact: true }).click();
    await dialog
      .getByText(id.endsWith('05') ? '这串授权码不对或已经失效，请重新取一次再粘贴。' : '已连上', {
        exact: true,
      })
      .waitFor();
    return;
  }
  if (id === 'f-crd-page-01') {
    await page.getByLabel('正在读取 Agent 列表…').waitFor();
    return;
  }
  if (id === 'f-crd-page-02') {
    await page.getByText('Agent 列表没能加载出来，现在看不到这台机器上都配了些什么。').waitFor();
    return;
  }
  await page.getByRole('group', { name: 'Codex', exact: true }).waitFor();
  if (id === 'f-crd-page-03') {
    await page.getByPlaceholder('搜索 Agent').fill('gemini');
    await page.getByText('没有匹配的 Agent。').waitFor();
    return;
  }
  if (id === 'f-crd-page-04') {
    await page.getByText('剩 5 天', { exact: true }).waitFor();
    return;
  }
  if (id.startsWith('f-crd-revoke')) {
    const target = id.endsWith('03') ? 'Claude Code' : 'Codex';
    await page
      .getByRole('group', { name: target, exact: true })
      .getByRole('button', { name: '删除', exact: true })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const text = id.endsWith('02')
      ? '会被销毁的任务清单暂时查不到'
      : id.endsWith('03')
        ? '现在没有任务在用这份凭证，不会销毁任何任务。'
        : '会销毁这 5 个任务';
    await dialog.getByText(text, { exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent === '取消');
    return;
  }
  if (id === 'f-crd-mode-01') {
    await page
      .getByRole('radiogroup', { name: 'Codex', exact: true })
      .getByRole('radio', { name: 'API Key', exact: true })
      .click();
    await page.getByRole('dialog', { name: '切换到 API Key', exact: true }).waitFor();
    return;
  }
  if (id.startsWith('f-auth-panel')) {
    const card = page.getByRole('group', { name: 'Codex', exact: true });
    await card
      .getByRole('button', { name: id.endsWith('08') ? '登录帐号' : '添加 API Key', exact: true })
      .click();
    if (id.endsWith('08')) {
      await card.getByRole('button', { name: '开始帐号登录' }).click();
      await card.getByLabel('设备码').waitFor();
    } else {
      await card.locator('input[name="api-key"]').fill('sk-short');
      await card.getByRole('button', { name: '保存并继续' }).click();
      await card.getByText('这串 API Key 格式不对，没有保存。').waitFor();
    }
    return;
  }
  const gitSection = page.locator('#git-credentials');
  await gitSection.scrollIntoViewIfNeeded();
  if (id === 'f-crd-git-01') {
    await gitSection.getByRole('button', { name: '测试连接', exact: true }).click();
    await gitSection.getByText('连接成功', { exact: true }).waitFor();
  }
  if (id === 'f-crd-git-03') {
    await gitSection.getByRole('button', { name: '配置 HTTPS Token' }).click();
    await gitSection.locator('input[name="https-token"]').fill('synthetic-token');
    await gitSection.getByRole('button', { name: '测试连接', exact: true }).click();
    await gitSection.getByRole('alert').waitFor();
  }
  if (id === 'f-crd-git-04') {
    await gitSection
      .getByRole('group', { name: 'SSH 私钥', exact: true })
      .getByRole('button', { name: '更换', exact: true })
      .click();
    await gitSection
      .locator('textarea[name="ssh-private-key"]')
      .fill('ssh-ed25519 AAAAreview public-key');
    await gitSection.getByRole('alert').waitFor();
  }
  if (id === 'f-crd-git-05') {
    await gitSection.getByRole('button', { name: '删除', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent === '取消');
  }
  if (id === 'f-crd-page-05') {
    await page.goto(origin + '/');
    await page
      .getByRole('button', { name: /acme-web/ })
      .first()
      .click();
    await page.getByRole('button', { name: '配置 Git 凭证', exact: true }).click();
    await page.getByText('为项目「acme-web」配置凭证后，可重试克隆。', { exact: true }).waitFor();
  }
}
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
try {
  for (const theme of ['dark', 'light'])
    for (const width of [1440, 1024, 390]) {
      if (filter && filter !== `${theme}:${width}`) continue;
      for (const id of plans) {
        if (draftFilter && !draftFilter.split(',').includes(id)) continue;
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        page.setDefaultTimeout(12000);
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const requests = await install(page, id, theme);
        try {
          const variantScreenshots = await drive(page, id, theme, width);
          const metrics = await page.evaluate(() => ({
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
            overflowingElements: [
              ...document.querySelectorAll('input,code,section,[role="dialog"]'),
            ]
              .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
              .map((el) => el.tagName),
            font: getComputedStyle(document.body).fontFamily,
            dialogCount: document.querySelectorAll('[role="dialog"]').length,
          }));
          assert.equal(metrics.horizontalOverflow, false);
          assert.equal(metrics.overflowingElements.length, 0);
          assert.deepEqual(errors, []);
          const screenshot = `${id}-${theme}-${width}.png`;
          await page.screenshot({ path: `${output}/${screenshot}`, fullPage: true });
          results.push({
            draftId: id,
            theme,
            width,
            status: 'passed',
            screenshot,
            metrics,
            requestCount: requests.length,
            ...(variantScreenshots?.length ? { variantScreenshots } : {}),
          });
          console.log(`PASS ${id} ${theme}:${width}`);
        } catch (error) {
          const screenshot = `${id}-${theme}-${width}-failure.png`;
          await page.screenshot({ path: `${output}/${screenshot}`, fullPage: true });
          results.push({
            draftId: id,
            theme,
            width,
            status: 'failed',
            message: String(error),
            screenshot,
            errors,
            requests,
          });
          throw error;
        } finally {
          await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
          await page.close();
        }
      }
    }
} finally {
  await browser.close();
}
