import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.argv[2] ?? 'http://localhost:3100';
const output = process.argv[3] ?? '../artifacts/design-v2/welcome';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const results = [];
try {
  for (const theme of ['dark', 'light'])
    for (const width of [1440, 1024, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const result = { theme, width, errors: [], mutations: [], status: 'running' };
      results.push(result);
      let projects = [];
      page.on('pageerror', (error) => result.errors.push(error.message));
      await page.addInitScript(
        (theme) =>
          localStorage.setItem(
            'agent-platform-ui',
            JSON.stringify({ state: { theme }, version: 0 }),
          ),
        theme,
      );
      await page.route('**/api/**', async (route) => {
        const request = route.request();
        if (request.method() !== 'GET') {
          result.mutations.push(request.method());
          await route.fulfill({ status: 400, json: { code: 'VALIDATION_FAILED' } });
          return;
        }
        const path = new URL(request.url()).pathname;
        const json =
          path === '/api/system/init-status'
            ? { initialized: true, initializedAt: '2026-10-05T00:00:00.000Z' }
            : path === '/api/health'
              ? { status: 'ok' }
              : path === '/api/projects'
                ? projects
                : [];
        await route.fulfill({ json });
      });
      await page.routeWebSocket(/socket\.io/, (socket) => socket.close());
      try {
        await page.goto(origin);
        const gitCard = page.getByRole('button', { name: '用我的代码库', exact: true });
        const emptyCard = page.getByRole('button', { name: '开一个空项目', exact: true });
        await gitCard.waitFor();
        await page.evaluate(() => document.fonts.ready);
        const newTask = page.getByTestId('new-task-entry');
        assert.equal(await newTask.getAttribute('aria-disabled'), 'true');
        assert.equal(await newTask.evaluate((element) => element.disabled), false);
        await newTask.focus();
        assert.equal(await newTask.evaluate((element) => element === document.activeElement), true);
        assert.equal(await page.getByRole('button', { name: '按状态筛选任务' }).count(), 0);
        await newTask.click({ force: true });
        assert.equal(await page.getByTestId('modal-new-task').count(), 0);
        await page.screenshot({ path: `${output}/welcome-${theme}-${width}.png`, fullPage: true });
        await gitCard.click();
        const dialog = page.getByTestId('modal-new-project');
        await dialog.waitFor();
        assert.equal(
          await dialog.getByRole('radio', { name: 'Git 仓库', exact: true }).isChecked(),
          true,
        );
        assert.equal(
          await dialog
            .locator('[name="repo-url"]')
            .evaluate((element) => element === document.activeElement),
          true,
        );
        await page.screenshot({ path: `${output}/git-${theme}-${width}.png`, fullPage: true });
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(
          () => document.activeElement?.getAttribute('aria-labelledby') === 'welcome-git-title',
        );
        await emptyCard.click();
        await dialog.waitFor();
        assert.equal(
          await dialog.getByRole('radio', { name: '空项目', exact: true }).isChecked(),
          true,
        );
        assert.equal(await dialog.locator('[name="project-name"]').inputValue(), '未命名项目 1');
        await page.screenshot({ path: `${output}/empty-${theme}-${width}.png`, fullPage: true });
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(
          () => document.activeElement?.getAttribute('aria-labelledby') === 'welcome-empty-title',
        );
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
        );
        if (theme === 'light' && width === 1440) {
          projects = [1, 3].map((number) => ({
            id: `p${number}`,
            name: `未命名项目 ${number}`,
            sourceType: 'empty',
            cloneStatus: 'ready',
            cloneErrorCode: null,
            taskCount: 0,
            createdAt: '2026-10-05T00:00:00.000Z',
            updatedAt: '2026-10-05T00:00:00.000Z',
          }));
          await page.reload();
          await page.getByTestId('new-task-entry').waitFor();
          const find = page.getByRole('button', {
            name: '查找任务、项目与动作（⌘K）',
            exact: true,
          });
          await find.focus();
          await page.keyboard.press('Control+k');
          const query = page.getByRole('combobox', { name: '查找任务、项目与动作' });
          await query.fill('新建项目');
          await query.press('Enter');
          await dialog.waitFor();
          await dialog.getByRole('radio', { name: '空项目', exact: true }).check();
          assert.equal(await dialog.locator('[name="project-name"]').inputValue(), '未命名项目 4');
          await page.keyboard.press('Escape');
          await dialog.waitFor({ state: 'hidden' });
          await page.waitForFunction(() =>
            document.activeElement?.hasAttribute('data-command-trigger'),
          );
          result.maxNumberAndDialogFocus = true;
        }
        assert.deepEqual(result.errors, []);
        assert.deepEqual(result.mutations, []);
        result.status = 'passed';
      } catch (error) {
        result.status = 'failed';
        result.failure = error.message;
        await page.screenshot({ path: `${output}/failure-${theme}-${width}.png`, fullPage: true });
      } finally {
        await page.close();
      }
    }
} finally {
  await browser.close();
  await writeFile(`${output}/review.json`, JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results));
assert.equal(results.filter((result) => result.status !== 'passed').length, 0);
