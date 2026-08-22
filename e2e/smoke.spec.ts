import { test, expect } from '@playwright/test';
import type { SandboxProviderCapabilities } from '../src/types/sandbox';

/** provider 能力位 fixture（默认全开，按需覆盖）。 */
function providerCaps(
  overrides: Partial<SandboxProviderCapabilities> = {},
): SandboxProviderCapabilities {
  return {
    spawnTty: true,
    volumeMount: true,
    updateResources: true,
    pauseResume: true,
    snapshot: true,
    watchEvents: true,
    ...overrides,
  };
}

// S2 骨架（mock 边界集成，用例组 A 切片，12 §4.2）。
// S2 把工作台主区改为项目树优先：一进工作台不再直接显示新建沙箱面板，需先选中一个 cloneStatus==='ready'
// 的项目，SandboxTerminalContainer 才渲染 provider 选择 + 新建沙箱。故用例先在项目树里选中 ready 项目。
// 终端传输层是 socket.io：Playwright 的 routeWebSocket 拦不住 socket.io 握手，且不作假 echo——
// 故此处只验证到"选项目→新建沙箱→终端挂载→连接态展示"的 UI 链路（socket.io 连不上真后端时会进 connecting/reconnecting）。
// 真·浏览器→真后端 socket.io echo 的贯通，留待后端 daemon 起来后联调；帧收发/socketSessionKey 由 ptySocket 单测覆盖。
test.describe('S2 选项目 + 建沙箱 + 终端骨架（mock 边界）', () => {
  test('选 ready 项目 → 选 provider → 新建沙箱 → 终端挂载 + 连接态展示', async ({ page }) => {
    await page.route('**/api/health', (route) => route.fulfill({ json: {} }));

    // 项目列表返回一个 ready 项目（ProjectResponseDto；不含 repoUrl），使项目树里有一项可选并可建沙箱。
    await page.route('**/api/projects', (route) =>
      route.fulfill({
        status: 200,
        json: [
          {
            id: 'proj-e2e',
            name: 'E2E 冒烟项目',
            sourceType: 'empty',
            cloneStatus: 'ready',
            cloneErrorCode: null,
            taskCount: 0,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );

    // provider 档位由服务端 registry 驱动（GET /api/providers → ProviderResponseDto[]）：
    // e2e 跑生产构建（不启 MSW），故显式 stub。默认档由数组项的 isDefault 标记（无顶层字段）。
    // 这里带一个第三方 provider（acme），用例断言它无需改前端代码即出现在选项里。
    await page.route('**/api/providers', (route) =>
      route.fulfill({
        status: 200,
        json: [
          { name: 'aio', capabilities: providerCaps(), isDefault: true },
          { name: 'boxlite', capabilities: providerCaps({ snapshot: false }), isDefault: false },
          { name: 'acme', capabilities: providerCaps({ volumeMount: false }), isDefault: false },
        ],
      }),
    );

    await page.route('**/api/sandboxes', (route) =>
      route.fulfill({
        status: 201,
        json: {
          id: 'sb-e2e',
          projectId: 'proj-e2e',
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

    // S2：先在项目树里选中 ready 项目 → 才出现新建沙箱面板（selectedReady 门）。
    await page.getByRole('button', { name: /E2E 冒烟项目/ }).click();

    // provider 档位由服务端 registry 驱动：默认选中来自响应里 isDefault 的那项（aio），
    // 且第三方 provider（acme）无需改前端代码即出现在选项里。
    await expect(page.getByRole('radio', { name: /^aio/ })).toBeChecked();
    await expect(page.getByRole('radio', { name: /acme/ })).toBeVisible();

    // 改选 boxlite 证明可选档
    await page.getByRole('radio', { name: /boxlite/ }).check();
    await page.getByRole('button', { name: '发起任务并打开终端' }).click();

    // 终端容器挂载（xterm）+ 连接状态条出现（无真后端时为连接中/重连中）
    await expect(page.getByTestId('terminal-container')).toBeVisible();
    await expect(page.getByRole('status')).toBeVisible();
  });
});
