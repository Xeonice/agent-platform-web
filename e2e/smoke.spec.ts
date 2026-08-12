import { test, expect } from '@playwright/test';

// 骨架：用例组 A 的最小切片（12 §4.2）。REST 用 page.route，WS 用 routeWebSocket（不启 MSW，§4.1）。
// 后端契约与页面交互落地后按 §4.2 用例组 A–G 扩充。
test.describe('工作台冒烟（用例组 A 切片）', () => {
  test('工作台骨架渲染 + 选中任务打开终端 + WS echo', async ({ page }) => {
    // REST mock：GET /api/health
    await page.route('**/api/health', (route) =>
      route.fulfill({ json: { status: 'ok', version: 'e2e', schemaHash: 'e2e' } }),
    );

    // WS mock：/terminal echo（Playwright 原生 routeWebSocket，已 GA）
    await page.routeWebSocket(/\/terminal/, (ws) => {
      ws.send(JSON.stringify({ type: 'session', socketSessionKey: 'e2e-key' }));
      ws.onMessage((message) => {
        const text = typeof message === 'string' ? message : message.toString();
        const frame = JSON.parse(text) as { type?: string; data?: string };
        if (frame.type === 'input' && typeof frame.data === 'string') {
          ws.send(JSON.stringify({ type: 'data', data: frame.data }));
        }
      });
    });

    await page.goto('/');
    await expect(page.getByText('Agent 管理平台')).toBeVisible();

    // 选中演示任务 → 终端容器出现
    await page.getByRole('button', { name: /演示任务/ }).click();
    await expect(page.getByTestId('terminal-container')).toBeVisible();
  });
});
