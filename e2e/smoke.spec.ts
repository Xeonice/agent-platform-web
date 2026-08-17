import { test, expect } from '@playwright/test';

// S1 骨架（mock 边界集成，用例组 A 切片，12 §4.2）。
// 终端传输层已改 socket.io：Playwright 的 routeWebSocket 拦不住 socket.io 握手，且不作假 echo——
// 故此处只验证到"新建沙箱→终端挂载→连接态展示"的 UI 链路（socket.io 连不上真后端时会进 connecting/reconnecting）。
// 真·浏览器→真后端 socket.io echo 的贯通，留待后端 daemon 起来后联调；帧收发/socketSessionKey 由 ptySocket 单测覆盖。
test.describe('S1 建沙箱 + 终端骨架（mock 边界）', () => {
  test('选 provider → 新建沙箱 → 终端挂载 + 连接态展示', async ({ page }) => {
    await page.route('**/api/health', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/sandboxes', (route) =>
      route.fulfill({
        status: 201,
        json: {
          id: 'sb-e2e',
          projectId: 'default',
          runtime: 'shell',
          status: 'running',
          headless: false,
          timeoutMinutes: 120,
          idleTimeoutSec: 1800,
          waitingInput: false,
          version: 1,
        },
      }),
    );

    await page.goto('/');
    await expect(page.getByText('Agent 管理平台')).toBeVisible();

    // provider 选择：默认 aio，改选 boxlite 证明可选档
    await page.getByRole('radio', { name: /boxlite/ }).check();
    await page.getByRole('button', { name: '新建沙箱并打开终端' }).click();

    // 终端容器挂载（xterm）+ 连接状态条出现（无真后端时为连接中/重连中）
    await expect(page.getByTestId('terminal-container')).toBeVisible();
    await expect(page.getByRole('status')).toBeVisible();
  });
});
