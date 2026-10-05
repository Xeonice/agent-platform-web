import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import {
  NOW,
  connectivity,
  fixtures,
  intercept,
  assertNoRealWrites,
} from './design-shell-project.fixtures.mjs';

// Production route review. Every request/socket is fulfilled by fixtures; no server is started here.
const manifestPath = fileURLToPath(
  new URL('../../artifacts/migration-audit/shell-project-design-manifest.json', import.meta.url),
);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.equal(manifest.frames.length, 91);
assert.equal(new Set(manifest.frames.map((row) => row.id)).size, 91);
if (process.argv.includes('--validate')) {
  console.log(
    JSON.stringify({
      frames: manifest.frames.length,
      groups: [...new Set(manifest.frames.map((frame) => frame.group))],
      status: 'manifest-validated-browser-not-run',
    }),
  );
  process.exit(0);
}
const origin = process.argv[2] ?? 'http://localhost:3100';
const output = resolve(
  process.argv[3] ??
    fileURLToPath(new URL('../../artifacts/design-shell-project-v2/', import.meta.url)),
);
const scenario = process.env['DESIGN_REVIEW_SCENARIO'];
assert.ok(scenario === undefined || /^(dark|light):(1440|1024|390)$/.test(scenario));
const wanted = process.env['DESIGN_REVIEW_FRAME'];
const requestedFrames = wanted?.split(',');
const chosen = requestedFrames
  ? manifest.frames.filter((frame) =>
      requestedFrames.some(
        (value) =>
          frame.id === value || frame.group === value || frame.group.startsWith(`${value}-`),
      ),
    )
  : manifest.frames;
assert.ok(chosen.length > 0, 'DESIGN_REVIEW_FRAME must be a frame id or group from the manifest');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
const suffix = (frame) => Number(frame.id.slice(-2));
const text = (page, value) => page.getByText(value, { exact: true });
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();
async function captured(page, result, state) {
  await page.evaluate(() => document.fonts.ready);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${state}: no viewport horizontal overflow`,
  );
  const dialogs = await page.getByRole('dialog').evaluateAll((nodes) =>
    nodes.map((node) => ({
      width: node.getBoundingClientRect().width,
      scroll: node.scrollWidth,
      client: node.clientWidth,
    })),
  );
  assert.ok(
    dialogs.every((dialog) => dialog.scroll <= dialog.client + 1),
    `${state}: no dialog horizontal overflow`,
  );
  const file = `${result.frame}-${result.theme}-${result.width}-${state}.png`;
  await page.screenshot({ path: `${output}/${file}`, fullPage: true });
  result.states.push({
    state,
    screenshot: file,
    checks: ['viewport-horizontal-overflow', 'dialog-horizontal-overflow'],
  });
}
async function focusOn(locator) {
  await locator.waitFor();
  await locator
    .page()
    .waitForFunction((node) => document.activeElement === node, await locator.elementHandle());
}
async function projectMenu(page, id, item) {
  const viewport = page.viewportSize();
  if (viewport?.width === 390) {
    // The mobile rail deliberately hides project menus. Drive the object menu at 1024,
    // then review the same open dialog at 390; this is not a claim of a mobile menu entry.
    await page.setViewportSize({ width: 1024, height: viewport.height });
    const result = results.at(-1);
    if (result) result.driverViewport = 1024;
  }
  await page.locator(`[data-project-menu-trigger="${id}"]`).click();
  if (item) await page.getByTestId(`group-menu-${item}`).click();
  if (viewport?.width === 390 && item) await page.setViewportSize(viewport);
}
async function cloneFrame(page, f, id = 'p-infra', phase = 'cloning') {
  await page.waitForFunction(() => document.querySelector('[aria-label="主导航"]') !== null);
  await page.waitForTimeout(100);
  f.emit({
    event: 'project.clone_progress',
    projectId: id,
    phase,
    startedAt: phase === 'slow' ? '2026-10-04T23:49:54Z' : '2026-10-04T23:59:22Z',
    stage: phase === 'slow' ? 'enumerating' : 'receiving',
    objectsTotal: 26348,
    ...(phase === 'slow'
      ? {}
      : {
          percent: 42,
          objectsDone: 11066,
          receivedBytes: 18.4 * 1024 ** 2,
          bytesPerSecond: 1.2 * 1024 ** 2,
        }),
  });
}
async function openTaskForm(page, f, selected = true) {
  await page.getByTestId('new-task-entry').waitFor();
  await page.waitForFunction(
    (node) => !node.disabled,
    await page.getByTestId('new-task-entry').elementHandle(),
  );
  await page.getByTestId('new-task-entry').click();
  const dialog = page.getByTestId('modal-new-task');
  await dialog.waitFor();
  if (selected && (await dialog.getByLabel('项目', { exact: true }).inputValue()) === '')
    await dialog.getByLabel('项目', { exact: true }).selectOption('p-web');
  return dialog;
}
const seeded = (f, id, extra) =>
  Object.assign(
    f.tasks.find((task) => task.id === id),
    extra,
  );
function prepare(frame, f) {
  const n = suffix(frame);
  const group = frame.group;
  const config = { projectId: null, taskId: null, path: '/' };
  if (group === 'f-wb-welcome') {
    if (n === 2) f.init.initialized = false;
    f.projects = [];
    f.tasks = [];
  }
  if (group === 'f-wb-shell') f.hold = ['/api/projects', '/api/sandboxes'];
  if (group === 'f-wb-route') config.path = '/?taskId=t-deleted';
  if (group === 'f-wb-live' || (group === 'f-wb-banner' && n <= 2)) config.taskId = 't-running';
  if (group === 'f-wb-live') f.disconnectNamespace = n === 3 ? '/events' : '/terminal';
  if (group === 'f-wb-banner') {
    if (n === 1) {
      f.failPaths = ['/api/system/init-status', '/api/health'];
      f.disconnectNamespace = '/events';
    }
    if (n === 2) f.init.lastConnectivityCheck = connectivity('offline');
    if (n >= 3) {
      Object.assign(f.resources.disk, {
        usedPercent: 88,
        usedBytes: 440 * 1024 ** 3,
        availableBytes: 60 * 1024 ** 3,
        level: 'warn',
      });
      Object.assign(f.resources.retainedVolumes, {
        totalBytes: 410 * 1024 ** 3,
        percentOfDisk: 82,
        level: 'warn',
      });
      Object.assign(f.runtimes[0], {
        credentialStatus: 'expiring',
        expiresAt: '2026-10-10T00:00:00Z',
      });
    }
    if (n === 2 || n === 4)
      f.attention = [
        {
          projectId: 'p-web',
          projectName: 'acme-web',
          id: 'rule-nightly',
          name: '每天生成发布说明草稿',
          status: 'autoDisabled',
          consecutiveFailures: 10,
        },
        {
          projectId: 'p-web',
          projectName: 'acme-web',
          id: 'rule-hourly',
          name: '每小时检查构建告警',
          status: 'degraded',
          consecutiveFailures: 5,
        },
      ];
  }
  if (group === 'f-lch-form') {
    if (n !== 9) config.projectId = 'p-web';
    if (n === 4)
      f.hold = ['/api/runtimes', '/api/providers', '/api/images', '/api/projects/p-web/branches'];
    if (n === 5) f.failPaths = ['/api/runtimes', '/api/providers', '/api/images'];
    if (n === 6) f.launchError = 'RESOURCE_EXHAUSTED';
    if (n === 7) f.launchError = 'BRANCH_NOT_FOUND';
    if (n === 8) f.provider.capabilities.spawnTty = false;
    if (n === 9) config.path = '/?new=1&project=p-web';
  }
  if (group === 'f-lch-startup') {
    if (n === 1) {
      config.taskId = 't-failed';
      for (const [index, status] of [
        'pending',
        'scheduling',
        'preparing-workspace',
        'creating',
        'starting',
        'stopping',
        'destroying',
      ].entries())
        f.tasks.push({
          ...f.tasks[0],
          id: `t-phase-${index}`,
          name: `准备过程 ${index + 1}`,
          status,
          hasRun: false,
          waitingInput: false,
        });
    } else if (n === 2) {
      config.projectId = 'p-web';
      f.holdPost = ['/api/sandboxes'];
    } else {
      config.taskId = 't-created';
      f.tasks.unshift({
        ...f.tasks[0],
        id: 't-created',
        name: '修一下首页加载慢',
        status: n === 4 ? 'starting' : 'creating',
        hasRun: false,
        waitingInput: false,
        imageStaged: false,
      });
    }
  }
  if (group === 'f-sbx-relaunch') config.taskId = n === 2 ? 't-timeout' : 't-failed';
  if (group === 'f-sbx-stopstart') {
    config.taskId = n === 1 ? 't-running' : 't-stopped-0';
    if (n === 1) f.hold = ['/api/sandboxes/t-running/stop'];
    if (n === 4)
      seeded(f, 't-stopped-0', {
        status: 'failed',
        failureCode: 'PROVIDER_UNAVAILABLE',
        failureOperation: 'start',
      });
  }
  if (group === 'f-sbx-destroy') {
    config.taskId = n === 1 ? 't-failed' : 't-stopped-0';
    if (n === 1) f.holdDeleteTask = true;
    if (n === 2)
      seeded(f, 't-stopped-0', {
        status: 'failed',
        failureCode: 'PROVIDER_UNAVAILABLE',
        failureMessage: 'destroy instance: 容器服务没有响应',
        failureOperation: 'destroy',
      });
    if (n === 3)
      seeded(f, 't-stopped-0', {
        status: 'failed',
        failureCode: 'PROVIDER_UNAVAILABLE',
        failureOperation: 'start',
      });
  }
  if (group === 'f-sbx-headless') {
    config.taskId = 't-headless';
    if (n === 2 || n === 3) f.disconnectNamespace = '/tasks';
    if (n === 4 || n === 6) {
      f.agentTask = {
        ...f.agentTask,
        status: 'failed',
        exitCode: 1,
        artifacts: [
          { name: 'report.md', size: 12300, modifiedAt: NOW },
          { name: 'results.json', size: 980, modifiedAt: NOW },
        ],
        finishedAt: NOW,
      };
      f.agentOutcome = true;
    }
  }
  if (group === 'f-prj-clone') {
    config.projectId = n === 4 || n === 7 ? 'p-api' : 'p-infra';
    if (n === 2) f.cloneSlow = true;
    if (n === 5)
      Object.assign(
        f.projects.find((p) => p.id === 'p-infra'),
        { cloneStatus: 'failed', cloneErrorCode: 'CLONE_FAILED_PERMISSION' },
      );
  }
  if (group === 'f-prj-create') {
    config.taskId = 't-wait';
    f.projects = f.projects.filter((p) => p.id !== 'p-infra');
    if (n === 3) f.createError = 'ALREADY_EXISTS';
  }
  if (group === 'f-prj-info') {
    config.projectId = n === 2 ? 'p-docs' : 'p-web';
    if (n === 3) f.hold = ['/api/projects/p-web/sync'];
    if (n === 4) f.syncError = true;
  }
  if (group === 'f-prj-detail') config.projectId = 'p-web';
  if (group === 'f-prj-delete') {
    config.projectId = n === 2 ? 'p-web' : n === 3 ? 'p-infra' : 'p-example';
    if (n === 1 || n === 4) f.retained = f.retained.filter((v) => v.projectId !== 'p-example');
    if (n === 4) {
      f.hold = ['/api/projects/p-example'];
      f.deleteError = true;
    }
  }
  if (group === 'f-prj-retained') {
    config.projectId = n === 3 ? 'p-docs' : n === 4 ? 'p-web' : 'p-example';
    if (n === 4) f.failPaths = ['/api/retained-volumes'];
    if (n === 5) {
      config.projectId = null;
      f.resources.retainedVolumes.level = 'warn';
    }
  }
  if (group === 'f-dep-init') {
    if (n === 1) f.hold = ['/api/system/init-status'];
    if (n === 2 || n === 7) f.holdDiagnose = true;
    if ([4, 6].includes(n)) {
      f.networkMode = 'partial';
      f.init.lastConnectivityCheck = connectivity('partial');
    }
    if (n === 5) {
      f.networkMode = 'offline';
      f.init.lastConnectivityCheck = connectivity('offline');
    }
    if (n === 6) f.proxyError = true;
    if (n === 8) f.presetMode = 'registry';
    if (n === 9 || n === 10) {
      f.presetMode = 'stage';
      f.provisionError = n === 10;
    }
    if (n === 11)
      for (const runtime of f.runtimes)
        Object.assign(runtime, { credentialStatus: 'none', maskedIdentifier: undefined });
    if (n === 13)
      Object.assign(f.resources.disk, {
        availableBytes: 38 * 1024 ** 3,
        usedBytes: 462 * 1024 ** 3,
        usedPercent: 92.4,
        level: 'critical',
      });
    if (n === 14) f.initError = true;
  }
  if (config.taskId) config.path = `/?taskId=${config.taskId}`;
  return config;
}
async function exercise(page, frame, f, result, config) {
  const n = suffix(frame);
  const group = frame.group;
  const shot = (state) => captured(page, result, state);
  if (group === 'f-dep-init') {
    if (n === 1) {
      await text(page, '正在检查平台初始化状态…').waitFor();
      assert.equal(await page.getByTestId('init-wizard').count(), 0);
      return shot('checking-init-status');
    }
    await page.getByTestId('init-wizard').waitFor();
    if (n === 2) await click(page, '重新检测');
    if (n <= 5) {
      if (n === 5)
        assert.equal(
          await page.getByRole('button', { name: '下一步', exact: true }).isDisabled(),
          true,
        );
      return shot(
        n === 2
          ? 'rechecking-with-history'
          : n === 5
            ? 'offline-awaiting-acknowledgement'
            : n === 4
              ? 'partial-timeout'
              : 'online-result',
      );
    }
    await click(page, '下一步');
    if (n === 6) {
      await page.clock.fastForward(3000);
      const form = page
        .locator('form')
        .filter({ has: page.getByLabel('HTTP_PROXY', { exact: true }) });
      await form.getByLabel('HTTP_PROXY', { exact: true }).fill('http://127.0.0.1:7890');
      await click(page, '保存并重新检测');
      await page.getByRole('alert').filter({ hasText: '保存失败' }).waitFor();
      return shot('proxy-save-timeout');
    }
    if (n === 7) {
      assert.equal(
        await page.getByRole('button', { name: '下一步', exact: true }).isDisabled(),
        true,
      );
      return shot('preset-checking');
    }
    await page.getByTestId('preset-step-staged').waitFor();
    if (n === 8) {
      await page.getByTestId('preset-step-registry').filter({ hasText: '未通过' }).waitFor();
      assert.ok((await page.getByTestId('preset-step-lineage').innerText()).includes('未检查'));
      return shot('preset-registry-failed');
    }
    if (n === 9 || n === 10) {
      await page
        .getByTestId('preset-step-staged')
        .filter({ hasText: n === 10 ? '没有放到位' : '准备中' })
        .waitFor();
      return shot(n === 9 ? 'preset-preparing-progress' : 'preset-preparing-failed');
    }
    await page.getByRole('button', { name: /^(稍后配置，)?下一步$/, exact: true }).click();
    if (n === 11) {
      await page.getByRole('button', { name: '去配置', exact: true }).first().click();
      await page.getByRole('button', { name: '开始帐号登录', exact: true }).waitFor();
      return shot('subscription-unconfigured-panel');
    }
    if (n === 12) return shot('subscription-one-active-one-expired');
    await page.getByRole('button', { name: /^(稍后配置，)?下一步$/, exact: true }).click();
    const finish = page.getByRole('button', { name: '确认，开始使用', exact: true });
    await finish.waitFor();
    assert.equal(
      await page.getByTestId('resource-confirm').locator('button').count(),
      0,
      'Finish lives in fixed shell footer',
    );
    if (n === 14) {
      await finish.click();
      await text(page, '初始化没有完成').waitFor();
      assert.equal(await page.getByTestId('init-wizard').count(), 1);
    }
    return shot(n === 14 ? 'initialization-write-failed' : 'resource-low-but-can-finish');
  }
  if (group === 'f-wb-shell') {
    await page.locator('#workbench-main[aria-busy="true"]').waitFor();
    assert.equal(await page.getByTestId('new-task-entry').isDisabled(), true);
    return shot('initial-loading-skeleton');
  }
  if (group === 'f-wb-welcome' && n === 2) {
    await page.getByTestId('init-wizard').waitFor();
    await click(page, '下一步');
    await page.getByTestId('preset-step-staged').filter({ hasText: '通过' }).waitFor();
    await click(page, '下一步');
    await click(page, '下一步');
    await click(page, '确认，开始使用');
    await page.getByTestId('init-wizard').waitFor({ state: 'hidden' });
  }
  await page.getByRole('navigation', { name: '主导航', exact: true }).waitFor();
  if (group === 'f-wb-welcome') {
    await page.getByRole('button', { name: '用我的代码库', exact: true }).waitFor();
    if (n === 2) {
      await page.getByTestId('new-task-entry').click({ force: true });
      await text(page, '先新建一个项目').waitFor();
    }
    assert.equal(await page.getByTestId('modal-new-task').count(), 0);
    return shot(n === 2 ? 'welcome-new-task-reason' : 'welcome-empty-instance');
  }
  if (group === 'f-wb-route') {
    await page.getByText(/找不到(?:这个)?任务/).waitFor();
    assert.equal(new URL(page.url()).searchParams.has('taskId'), false);
    return shot('deleted-task-fallback');
  }
  if (group === 'f-wb-overview') {
    await click(page, '按状态筛选');
    await page.getByRole('menuitemradio', { name: '等待输入', exact: true }).click();
    await page.getByRole('button', { name: '移除筛选：等待输入', exact: true }).first().waitFor();
    return shot('shared-waiting-input-filter');
  }
  if (group === 'f-wb-cmdk') {
    await page.getByRole('button', { name: '查找任务、项目与动作（⌘K）', exact: true }).click();
    const query = page.getByRole('combobox', { name: '查找任务、项目与动作' });
    await query.fill(n === 1 ? '新建' : '动作');
    await page.getByTestId('command-palette').waitFor();
    await shot(n === 1 ? 'search-new-actions' : 'overview-all-project-actions');
    if (n === 1) {
      await query.press('Enter');
      await page.getByTestId('modal-new-project').waitFor();
      await page.keyboard.press('Escape');
      await focusOn(page.locator('[data-command-trigger]').first());
      await shot('command-dialog-return-focus');
    }
    return;
  }
  if (group === 'f-wb-banner') {
    const title =
      n === 1
        ? '无法确认平台状态'
        : n === 2
          ? '离线模式'
          : n === 3
            ? '磁盘快满了'
            : '有 1 条定时规则已自动停用';
    await page
      .getByText(title, { exact: n !== 2 })
      .first()
      .waitFor();
    if (n === 2) await page.getByTestId('new-task-entry').click({ force: true });
    return shot(
      [
        '',
        'backend-unavailable',
        'offline-and-governance',
        'governance-stack-collapsed',
        'overview-rule-attention',
      ][n],
    );
  }
  if (group === 'f-wb-live') {
    if (n === 2) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await page.clock.fastForward(31000);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      await page.getByRole('button', { name: '手动重连', exact: true }).waitFor();
    } else
      await page
        .getByText(/正在重连/)
        .first()
        .waitFor();
    await shot(
      n === 2
        ? 'terminal-reconnect-exhausted'
        : n === 3
          ? 'events-reconnecting-terminal-alive'
          : 'terminal-reconnecting',
    );
    if (n === 3) {
      f.disconnectNamespace = null;
      await page.clock.fastForward(30000);
      await page.getByText('实时更新已中断，正在重连…').waitFor({ state: 'hidden' });
      await shot('events-recovered-refresh');
    }
    return;
  }
  if (group === 'f-lch-form' || (group === 'f-lch-startup' && n === 2)) {
    let dialog =
      n === 9 && group === 'f-lch-form'
        ? page.getByTestId('modal-new-task')
        : await openTaskForm(page, f);
    await dialog.waitFor();
    const create = dialog.getByRole('button', {
      name: /^(发起任务并打开终端|创建中…)$/,
      exact: true,
    });
    if (group === 'f-lch-form' && [1, 4, 5, 9].includes(n)) {
      if (n === 9) {
        await dialog.getByLabel('任务指令（可选）').fill('刷新前的局部输入');
        await page.reload();
        dialog = page.getByTestId('modal-new-task');
        await dialog.waitFor();
        assert.equal(await dialog.getByLabel('任务指令（可选）').inputValue(), '');
        await page.getByText('刷新后指令未保留，请重新输入', { exact: true }).waitFor();
      }
      if (n === 1) {
        await create.focus();
        await focusOn(create);
        assert.equal(await create.getAttribute('aria-disabled'), 'true');
      }
      return shot(
        [
          '',
          'agent-unselected',
          '',
          '',
          'runtime-provider-image-loading',
          'runtime-provider-image-errors',
          '',
          '',
          '',
          'deep-link-reloaded',
        ][n],
      );
    }
    await dialog.getByRole('radio', { name: /Codex/ }).check();
    await dialog
      .getByLabel('任务指令（可选）')
      .fill(
        n === 3 && group === 'f-lch-form'
          ? '日'.repeat(8123)
          : '修一下首页加载慢\n'.padEnd(236, '续'),
      );
    if (group === 'f-lch-form' && n === 3) {
      assert.equal(
        await dialog.getByLabel('任务指令（可选）').getAttribute('aria-invalid'),
        'true',
      );
      assert.equal(await create.getAttribute('aria-disabled'), 'true');
    }
    if (group === 'f-lch-form' && n === 7)
      await dialog.getByLabel('分支（可选）').selectOption('feat/login-refresh');
    if (group === 'f-lch-form' && n === 10) {
      const images = dialog.getByLabel('镜像（可选）');
      assert.equal(await images.locator('option[value="invalid-image"]').isDisabled(), true);
      await images.focus();
      await images.press('Space');
    }
    if ((group === 'f-lch-form' && [6, 7].includes(n)) || group === 'f-lch-startup') {
      await create.click();
      if (group === 'f-lch-startup') {
        await text(page, '创建中…').waitFor();
        await page.keyboard.press('Escape');
        assert.equal(await dialog.isVisible(), true);
        return shot('submission-pending-dialog-locked');
      }
      await dialog
        .getByRole('alert')
        .filter({ hasText: n === 6 ? /8.*8/ : '未创建任何任务' })
        .waitFor();
      assert.equal(
        await dialog.getByLabel('任务指令（可选）').inputValue(),
        '修一下首页加载慢\n'.padEnd(236, '续'),
      );
    }
    return shot(
      n === 3
        ? 'prompt-too-long'
        : n === 6
          ? 'resource-exhausted-real-capacity'
          : n === 7
            ? 'branch-not-found-no-side-effects'
            : n === 8
              ? 'provider-without-terminal'
              : n === 10
                ? 'image-options-invalid-disabled'
                : 'ready-to-launch',
    );
  }
  if (group === 'f-lch-startup') {
    if (n === 1) {
      await page.getByTestId('sandbox-outcome').waitFor();
      return shot('mixed-task-statuses-and-failure');
    }
    await page.getByTestId('sandbox-startup-progress').waitFor();
    if (n >= 5) await page.clock.fastForward(400000);
    else await page.clock.fastForward(n === 4 ? 200000 : 42000);
    if (n === 6) {
      await click(page, '取消并删除…');
      await focusOn(page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }));
      assert.equal(await page.getByRole('dialog').getByRole('radio').count(), 0);
    }
    return shot(
      n === 3
        ? 'creating-image-progress'
        : n === 4
          ? 'first-use-image-starting'
          : n === 5
            ? 'startup-stuck-with-actions'
            : 'startup-cancel-confirmation',
    );
  }
  if (group === 'f-sbx-relaunch') {
    await page.getByTestId('sandbox-outcome').waitFor();
    if (n === 1) {
      await page.getByTestId('copy-diagnostics').click();
      await text(page, '诊断信息已复制').waitFor();
    }
    if (n === 3) {
      await click(page, '重新发起');
      const dialog = page.getByTestId('modal-new-task');
      await dialog.waitFor();
      assert.equal(await dialog.getByLabel('项目', { exact: true }).inputValue(), 'p-web');
      assert.equal(await dialog.getByRole('radio', { name: /Codex/ }).isChecked(), true);
      assert.equal(await dialog.getByLabel('任务指令（可选）').inputValue(), '');
    }
    if (n === 4) {
      await click(page, '检查镜像地址');
      await page.waitForURL('**/settings/images?*');
      await page.getByRole('region', { name: '任务来源提示' }).waitFor();
      assert.equal(await page.locator('[data-highlighted="true"]').count(), 1);
    }
    return shot(
      [
        '',
        'image-failure-copy-diagnostics',
        'timeout-outcome',
        'relaunch-prefill',
        'image-source-navigation',
      ][n],
    );
  }
  if (group === 'f-sbx-stopstart') {
    if (n === 1) {
      await page.getByRole('button', { name: '任务菜单', exact: true }).last().click();
      await page.getByRole('menuitem', { name: '停止', exact: true }).click();
      await page.getByText('正在停止…', { exact: false }).first().waitFor();
    }
    if (n === 3) {
      await click(page, '启动');
      await page.getByTestId('sandbox-startup-progress').waitFor();
      await page.clock.fastForward(5000);
      await page
        .getByText('从已停止重新启动：沿用原来的代码副本，Agent 会话从头开始', { exact: true })
        .first()
        .waitFor();
    }
    return shot(
      [
        '',
        'stopping-frozen-terminal',
        'stopped-task-outcome',
        'restart-with-existing-workspace',
        'restart-provider-failure',
      ][n],
    );
  }
  if (group === 'f-sbx-destroy') {
    if (n === 2) {
      await page.getByTestId('sandbox-outcome').waitFor();
      await page
        .getByTestId('sandbox-outcome')
        .getByText('诊断码：PROVIDER_UNAVAILABLE', { exact: true })
        .waitFor();
      if (result.width !== 390)
        await page.getByText('删除失败：容器服务没有响应', { exact: false }).first().waitFor();
      return shot('destroy-provider-failed-idempotent-retry');
    }
    await page.getByRole('button', { name: '任务菜单', exact: true }).last().click();
    await page.getByRole('menuitem', { name: '销毁任务…', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await focusOn(dialog.getByRole('button', { name: '取消', exact: true }));
    if (n === 1) {
      assert.equal(await dialog.getByRole('radio').count(), 0);
      await dialog.getByRole('button', { name: '销毁任务', exact: true }).click();
      await page.getByText('正在销毁任务「迁移构建脚本」…', { exact: true }).waitFor();
      assert.equal(new URL(page.url()).searchParams.has('taskId'), false);
      await shot('destroy-pending-overview-excludes-task');
      f.release('task-delete');
      await page.getByText('已销毁任务「迁移构建脚本」', { exact: true }).waitFor();
      return shot('destroy-complete-task-removed');
    }
    assert.equal(await dialog.getByRole('radio').first().isChecked(), true);
    await shot('destroy-after-start-failure-retains-workspace-default');
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    return;
  }
  if (group === 'f-sbx-headless') {
    await page.getByTestId('task-output-pane').waitFor();
    assert.equal(
      f.namespaces.includes('/terminal'),
      false,
      'A headless task must never attach an interactive Agent',
    );
    assert.equal(await page.getByRole('tab', { name: /终端|Agent/ }).count(), 0);
    if (n === 2) await page.getByText(/正在重连事件流/).waitFor();
    if (n === 3) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await page.clock.fastForward(31000);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      await page.getByRole('button', { name: '重新连接', exact: true }).waitFor();
    }
    if (n === 4 || n === 6) await page.getByTestId('task-outcome').waitFor();
    if (n === 5) {
      await click(page, '终止任务');
      const confirm = page.getByRole('button', { name: '确认终止', exact: true });
      await focusOn(confirm);
      await shot('headless-cancel-inline-confirm');
      await page.keyboard.press('Escape');
      await focusOn(page.getByRole('button', { name: '终止任务', exact: true }));
      await click(page, '终止任务');
      await confirm.click();
      await page.getByText('正在终止…（两阶段强杀）').waitFor();
      return shot('headless-cancel-pending');
    }
    if (n === 6) {
      await click(page, '接着聊（续接这轮会话）');
      await page.getByTestId('headless-task-launcher').waitFor();
      await page
        .getByLabel('任务指令', { exact: true })
        .fill('继续整理失败的那部分，保留上一轮上下文。');
      await shot('headless-resume-prompt');
      await click(page, '改为全新会话');
      await shot('headless-new-session-choice');
      return;
    }
    return shot(
      [
        '',
        'headless-running-readonly-tools',
        'headless-stream-reconnecting',
        'headless-stream-exhausted',
        'headless-failed-artifacts',
      ][n],
    );
  }
  if (group === 'f-prj-create') {
    await click(page, '新建项目');
    const dialog = page.getByTestId('modal-new-project');
    await dialog.waitFor();
    await dialog
      .getByLabel('项目名称', { exact: true })
      .fill(n === 3 ? 'acme-web' : 'infra-scripts');
    if (n === 2) await dialog.getByRole('radio', { name: '空项目', exact: true }).check();
    if (n === 1) {
      await dialog.getByLabel(/仓库地址/).focus();
      await focusOn(dialog.getByLabel(/仓库地址/));
      assert.equal(
        await dialog.getByRole('button', { name: '创建项目', exact: true }).isDisabled(),
        true,
      );
      return shot('create-git-required-fields');
    }
    if (n === 2) {
      assert.equal(await dialog.getByTestId('repo-branch-field').count(), 0);
      await shot('create-empty-fields');
      await click(page, '创建项目');
      await dialog.waitFor({ state: 'hidden' });
      return shot('empty-project-ready-immediately');
    }
    await dialog.getByLabel(/仓库地址/).fill('https://github.com/acme/web.git');
    await click(page, '创建项目');
    if (n === 3) {
      await text(page, '项目名已存在，请换一个名称。').waitFor();
      return shot('project-name-collision-inputs-kept');
    }
    await text(page, '正在克隆项目…').first().waitFor();
    if (n === 4 || n === 5) {
      await cloneFrame(page, f, 'p-created', n === 5 ? 'slow' : 'cloning');
      if (n === 5) await page.clock.fastForward(92000);
      return shot(n === 4 ? 'new-project-clone-progress' : 'new-project-slow-clone');
    }
    const row = f.projects.find((p) => p.id === 'p-created');
    Object.assign(
      row,
      n === 8
        ? { cloneStatus: 'ready', cloneErrorCode: null }
        : {
            cloneStatus: 'failed',
            cloneErrorCode: n === 6 ? 'CLONE_FAILED_PERMISSION' : 'CLONE_FAILED_NOT_FOUND',
          },
    );
    f.emit({
      event: 'project.clone_progress',
      projectId: 'p-created',
      phase: n === 8 ? 'done' : 'failed',
      ...(n === 8 ? {} : { errorCode: row.cloneErrorCode }),
    });
    await dialog.getByText(n === 8 ? '项目可用了' : '克隆失败', { exact: true }).waitFor();
    return shot(
      n === 8
        ? 'new-project-clone-complete'
        : n === 6
          ? 'new-project-clone-permission-failure'
          : 'new-project-clone-not-found',
    );
  }
  if (group === 'f-prj-clone') {
    if (n <= 3 || n === 6) await cloneFrame(page, f, 'p-infra', n === 2 ? 'slow' : 'cloning');
    if ([3, 4].includes(n)) {
      await projectMenu(page, config.projectId);
      if (result.width === 390) await page.setViewportSize({ width: 390, height: 900 });
    }
    if (n === 2) await page.clock.fastForward(92000);
    if (n === 6) {
      await projectMenu(page, 'p-infra', 'cancel-clone');
      await text(page, '克隆被中断，请重试。').waitFor();
    }
    if (n === 7) {
      await click(page, '改为空项目');
      await page.getByText('「acme-api」下还没有任务。', { exact: true }).waitFor();
    }
    return shot(
      [
        '',
        'selected-project-clone-progress',
        'selected-project-slow-clone',
        'cloning-project-menu',
        'failed-project-menu',
        'clone-permission-failed',
        'clone-interrupted-project-preserved',
        'convert-to-empty-ready',
      ][n],
    );
  }
  if (group === 'f-prj-info') {
    await page.getByTestId('project-info-trigger').click();
    const info = page.getByRole('dialog', {
      name: config.projectId === 'p-docs' ? 'docs-site' : 'acme-web',
      exact: true,
    });
    await info.waitFor();
    if (n === 2) {
      assert.equal(
        await info.getByRole('button', { name: '拉取最新代码', exact: true }).count(),
        0,
      );
      await focusOn(info);
    } else if (n === 1)
      await focusOn(info.getByRole('button', { name: '拉取最新代码', exact: true }));
    if (n >= 3) {
      await info.getByRole('button', { name: '拉取最新代码', exact: true }).click();
      if (n === 3)
        await page.getByRole('button', { name: '正在拉取最新代码', exact: true }).first().waitFor();
      else if (n === 4)
        await info.getByRole('button', { name: '配置 Git 凭证', exact: true }).waitFor();
      else await text(page, '已更新到最新；已建好的任务不受影响').first().waitFor();
    }
    return shot(
      [
        '',
        'git-project-info-focused',
        'empty-project-info-readonly',
        'project-sync-busy',
        'project-sync-permission-failed',
        'project-sync-success',
      ][n],
    );
  }
  if (group === 'f-prj-detail') {
    await projectMenu(page, 'p-web', 'open-detail');
    await page.getByTestId('project-detail-panel').waitFor();
    await shot('project-detail-readonly');
    if (result.width === 390) await page.setViewportSize({ width: 1024, height: 900 });
    await page.keyboard.press('Escape');
    await focusOn(page.locator('[data-project-menu-trigger="p-web"]'));
    if (result.width === 390) await page.setViewportSize({ width: 390, height: 900 });
    return;
  }
  if (group === 'f-prj-delete') {
    await projectMenu(page, config.projectId, 'delete');
    const dialog = page.getByTestId('delete-project-confirm');
    await dialog.waitFor();
    const cancel = page.getByTestId('delete-cancel');
    await page.clock.runFor(100);
    await focusOn(cancel);
    const confirm = page.getByTestId('delete-confirm');
    if (n === 2) {
      await page.getByTestId('delete-running-warning').waitFor();
      assert.equal(await confirm.getAttribute('aria-disabled'), 'true');
    }
    if (n === 3) await page.getByTestId('delete-cloning-note').waitFor();
    if (n === 4) {
      await confirm.click();
      await text(page, '删除中…').waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await dialog.isVisible(), true);
      await shot('project-delete-busy-locked');
      f.release('/api/projects/p-example');
      await page.getByTestId('delete-error').waitFor();
      assert.equal(await cancel.isDisabled(), false);
      return shot('project-delete-failed-preserved');
    }
    await shot(
      n === 1
        ? 'project-delete-ready-consequences'
        : n === 2
          ? 'project-delete-active-and-retained-guards'
          : 'project-delete-cloning-alternative',
    );
    if (result.width === 390) await page.setViewportSize({ width: 1024, height: 900 });
    await page.keyboard.press('Escape');
    await focusOn(page.locator(`[data-project-menu-trigger="${config.projectId}"]`));
    if (result.width === 390) await page.setViewportSize({ width: 390, height: 900 });
    return;
  }
  if (group === 'f-prj-retained') {
    if (n === 5) {
      await page.getByRole('button', { name: '去清理', exact: true }).click();
      await page.getByLabel('范围').selectOption('');
    } else await projectMenu(page, config.projectId, 'open-retained');
    const panel = page.getByTestId('retained-volumes-panel');
    await panel.waitFor();
    if (n === 2) {
      const row = page.getByTestId('retained-volume-row').filter({ hasText: '补一份示例 README' });
      await row.getByRole('button', { name: '删除', exact: true }).click();
      await page.getByTestId('retained-volume-confirm').waitFor();
      await focusOn(page.getByRole('button', { name: '取消', exact: true }));
      await shot('retained-delete-same-dialog-confirmation');
      await click(page, '取消');
      await focusOn(row.getByRole('button', { name: '删除', exact: true }));
      return shot('retained-confirm-cancel-restores-row-focus');
    }
    if (n === 3) await page.getByTestId('retained-volumes-empty').waitFor();
    if (n === 4) {
      await text(page, '没能读出保留下来的成果').waitFor();
      assert.equal(await page.getByTestId('retained-volumes-empty').count(), 0);
    }
    return shot(
      n === 1
        ? 'retained-sorted-expiry-and-source'
        : n === 3
          ? 'retained-empty-project'
          : n === 4
            ? 'retained-load-failed'
            : 'retained-all-projects-groups',
    );
  }
  throw new Error(`Unimplemented frame ${frame.id}`);
}
try {
  for (const theme of ['dark', 'light'])
    for (const width of [1440, 1024, 390]) {
      if (scenario && scenario !== `${theme}:${width}`) continue;
      for (const frame of chosen) {
        const result = {
          frame: frame.id,
          theme,
          width,
          status: 'running',
          states: [],
          unexpected: [],
          errors: [],
          verification: 'production-browser-fixtures',
        };
        results.push(result);
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        page.setDefaultTimeout(15000);
        const f = fixtures(frame.id);
        const config = prepare(frame, f);
        page.on('pageerror', (error) => result.errors.push(error.message));
        try {
          await page.clock.install({ time: new Date(NOW) });
          await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
          if (f.presetMode === 'stage')
            await page.addInitScript(
              ({ error }) => {
                const originalFetch = window.fetch.bind(window);
                window.fetch = (input, init) => {
                  const url = input instanceof Request ? input.url : String(input);
                  if (!url.includes('/api/system/preset-image/provision'))
                    return originalFetch(input, init);
                  const encoder = new TextEncoder();
                  const stream = new ReadableStream({
                    start(controller) {
                      const stage = {
                        event: 'stage',
                        stage: 'load',
                        status: error ? 'failed' : 'running',
                        message: error ? '已下载 271 MB / 约 320 MB' : '已下载 118 MB / 约 320 MB',
                        progress: error ? null : 0.37,
                      };
                      controller.enqueue(
                        encoder.encode(`event: stage\ndata: ${JSON.stringify(stage)}\n\n`),
                      );
                      if (error) {
                        controller.enqueue(
                          encoder.encode(
                            `event: done\ndata: ${JSON.stringify({ event: 'done', ok: false, error: '拉取镜像时连接中断（unexpected EOF），这次没有放到位' })}\n\n`,
                          ),
                        );
                        controller.close();
                      }
                    },
                  });
                  return Promise.resolve(
                    new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }),
                  );
                };
              },
              { error: f.provisionError === true },
            );
          await page.addInitScript(
            ({ theme, projectId, taskId }) =>
              localStorage.setItem(
                'agent-platform-ui',
                JSON.stringify({
                  state: {
                    theme,
                    selectedProjectId: projectId,
                    selectedSandboxId: taskId,
                    selectedTaskId: taskId === 't-headless' ? 'agent-run' : null,
                    sidebarCollapsed: false,
                  },
                  version: 0,
                }),
              ),
            { theme, projectId: config.projectId, taskId: config.taskId },
          );
          await intercept(page, f, result);
          await page.goto(`${origin}${config.path}`);
          await exercise(page, frame, f, result, config);
          assert.ok(result.states.length > 0, 'Frame requires a screenshot and behavior checks');
          assert.deepEqual(result.errors, []);
          assertNoRealWrites(f, result);
          result.status = 'passed';
        } catch (error) {
          result.status = 'failed';
          result.failure = error instanceof Error ? error.message : String(error);
          result.clockAtFailure = await page.evaluate(() => Date.now());
          result.activeElementAtFailure = await page
            .evaluate(() => document.activeElement?.outerHTML.slice(0, 1600))
            .catch(() => undefined);
          await captured(page, result, 'failure').catch(() => undefined);
        } finally {
          for (const key of f.pending.keys()) f.release(key);
          result.requests = { reads: f.reads, writes: f.writes, socketNamespaces: f.namespaces };
          await page.close();
          await writeFile(`${output}/review.json`, JSON.stringify(results, null, 2));
        }
        console.log(
          `${result.status}: ${frame.id} ${theme}:${width}${result.failure ? ` — ${result.failure}` : ''}`,
        );
      }
    }
} finally {
  await writeFile(`${output}/review.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
assert.equal(
  results.filter((result) => result.status !== 'passed').length,
  0,
  `See ${output}/review.json`,
);
