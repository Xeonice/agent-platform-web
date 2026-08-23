import { test, expect } from '@playwright/test';
import type { SandboxProviderCapabilities } from '../src/types/sandbox';
import type { RuntimeDto } from '../src/types/runtimeCredential';

// S5 Task 发起链路（mock 边界，12 §4.2 用例组 C 切片）：
//   ① 任务指令随 POST /api/sandboxes 提交；
//   ② 刷新后 localStorage **无指令残留**（15 §3.5 安全红线）；
//   ③ 默认任务名用后端返回的 name（前端不派生）；
//   ④ 进度卡四格顺序 = 面向用户的展示序（初始化 → 拉取镜像 → 准备工作区 → 启动实例），
//      且 `creating` 高亮的是「拉取镜像」而不是第 3 格（展示序 ≠ 状态机序）。
//   ⑤ **刷新后仍能看到失败原因**：WS 帧错过就没了，靠 `GET /api/sandboxes/:id` 的
//      `failureCode`/`failureMessage` 恢复（持久化的 selectedSandboxId 是入口）。
// 装 CLI 子文案（runtime.install_progress）与 WS 即时失败码靠真 socket.io /events 推送，
// Playwright 拦不住 socket.io 握手，故由 slice/hook/container 单测覆盖，此处不做假。

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
    headlessTask: false,
    ...overrides,
  };
}

/**
 * runtime 由服务端 registry 驱动（GET /api/runtimes）。**必须 mock**：平台没有「默认
 * runtime」的概念（04 §8），不选就发不出去——不 mock 的话面板停在「后端未注册任何
 * runtime」，按钮一直 disabled，测试只会超时在一次点击上，看不出真正的原因。
 */
const RUNTIMES: RuntimeDto[] = [
  {
    id: 'codex',
    displayName: 'Codex',
    vendor: 'OpenAI',
    authMethods: ['api-key'],
    credentialStatus: 'none',
    credentials: [],
  },
];

const PROMPT = '分析 /srv/internal-repo 的架构并输出摘要';

test.describe('S5 发起任务：initialPrompt + 默认任务名 + 四阶段进度卡', () => {
  test('填指令 → 提交 → 进度卡按展示序渲染；localStorage 无指令残留', async ({ page }) => {
    await page.route('**/api/health', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/projects', (route) =>
      route.fulfill({
        status: 200,
        json: [
          {
            id: 'proj-e2e',
            name: 'E2E 发起项目',
            sourceType: 'empty',
            cloneStatus: 'ready',
            cloneErrorCode: null,
            taskCount: 0,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );
    await page.route('**/api/providers', (route) =>
      route.fulfill({
        status: 200,
        json: [{ name: 'aio', capabilities: providerCaps(), isDefault: true }],
      }),
    );
    await page.route('**/api/runtimes', (route) => route.fulfill({ status: 200, json: RUNTIMES }));

    let sentPrompt: string | undefined;
    await page.route('**/api/sandboxes', async (route) => {
      const body: unknown = route.request().postDataJSON();
      sentPrompt =
        typeof body === 'object' && body !== null && 'initialPrompt' in body
          ? String(body.initialPrompt)
          : undefined;
      await route.fulfill({
        status: 201,
        json: {
          id: 'sb-e2e-launch',
          projectId: 'proj-e2e',
          runtime: 'codex',
          // `creating` = 技术上"建实例/拉镜像"，展示上应点亮**第 2 格「拉取镜像」**。
          status: 'creating',
          headless: false,
          timeoutMinutes: 120,
          idleTimeoutSec: 1800,
          waitingInput: false,
          version: 1,
          // 后端派生的默认任务名（前端直接用）。
          name: '分析 /srv/internal-repo 的…',
        },
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: /E2E 发起项目/ }).click();

    await expect(page.getByRole('radio', { name: /^aio/ })).toBeChecked();
    // provider 有 isDefault 会预选；runtime **不预选**，必须显式点一下。
    await page.getByRole('radio', { name: /^codex/ }).check();
    await page.getByLabel('任务指令（可选）').fill(PROMPT);
    await page.getByRole('button', { name: '发起任务并打开终端' }).click();

    // ① 指令进了请求体
    await expect.poll(() => sentPrompt).toBe(PROMPT);

    // ③ 任务名来自后端 name
    await expect(page.getByText('正在启动：分析 /srv/internal-repo 的…')).toBeVisible();

    // ④ 四格、顺序为展示序，且 creating 点亮「拉取镜像」（第 2 格）
    const phases = page.getByRole('status').getByRole('listitem');
    await expect(phases).toHaveCount(4);
    await expect(phases.nth(0)).toContainText('初始化');
    await expect(phases.nth(1)).toContainText('拉取镜像');
    await expect(phases.nth(2)).toContainText('准备工作区');
    await expect(phases.nth(3)).toContainText('启动实例');
    await expect(phases.nth(1)).toContainText('●'); // active 标记

    // ② 安全红线：指令不落任何前端持久化
    const dump = await page.evaluate(() => JSON.stringify(globalThis.localStorage));
    expect(dump).not.toContain('internal-repo');
    expect(dump).not.toContain('initialPrompt');
  });

  test('门口拒绝（后端标 sideEffectFree）→ 就地提示改配置，不出"重新创建"失败卡', async ({
    page,
  }) => {
    await page.route('**/api/health', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/projects', (route) =>
      route.fulfill({
        status: 200,
        json: [
          {
            id: 'proj-e2e',
            name: 'E2E 发起项目',
            sourceType: 'empty',
            cloneStatus: 'ready',
            cloneErrorCode: null,
            taskCount: 0,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );
    await page.route('**/api/providers', (route) =>
      route.fulfill({
        status: 200,
        json: [{ name: 'aio', capabilities: providerCaps(), isDefault: true }],
      }),
    );
    await page.route('**/api/runtimes', (route) => route.fulfill({ status: 200, json: RUNTIMES }));
    await page.route('**/api/sandboxes', (route) =>
      route.fulfill({
        status: 409,
        json: {
          code: 'UNSUPPORTED_CAPABILITY',
          message: 'provider aio 不支持 snapshot',
          retryable: false,
          // ⚠️ 前端判据读的就是这个字段（不是 409）。去掉它 ⇒ 保守读法把这次拒绝
          // 渲染成失败卡，下面的 `未创建任何任务` 断言当场红 —— 这正是它该有的样子。
          sideEffectFree: true,
        },
      }),
    );

    await page.goto('/');
    await page.getByRole('button', { name: /E2E 发起项目/ }).click();
    await expect(page.getByRole('radio', { name: /^aio/ })).toBeChecked();
    // provider 有 isDefault 会预选；runtime **不预选**，必须显式点一下。
    await page.getByRole('radio', { name: /^codex/ }).check();
    await page.getByRole('button', { name: '发起任务并打开终端' }).click();

    // 就地提示（仍在新建面板），且不出现失败卡的"重新创建/换镜像"入口。
    await expect(page.getByText(/未创建任何任务/)).toBeVisible();
    await expect(page.getByRole('button', { name: '发起任务并打开终端' })).toBeVisible();
    await expect(page.getByTestId('sandbox-outcome')).toHaveCount(0);
  });

  test('刷新后仍能看到失败原因：DTO 的 failureCode/failureMessage 是救命稻草', async ({ page }) => {
    await page.route('**/api/health', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/projects', (route) =>
      route.fulfill({
        status: 200,
        json: [
          {
            id: 'proj-e2e',
            name: 'E2E 发起项目',
            sourceType: 'empty',
            cloneStatus: 'ready',
            cloneErrorCode: null,
            taskCount: 0,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );
    await page.route('**/api/providers', (route) =>
      route.fulfill({
        status: 200,
        json: [{ name: 'aio', capabilities: providerCaps(), isDefault: true }],
      }),
    );
    await page.route('**/api/runtimes', (route) => route.fulfill({ status: 200, json: RUNTIMES }));
    await page.route('**/api/sandboxes', (route) =>
      route.fulfill({
        status: 201,
        json: {
          id: 'sb-e2e-refresh',
          projectId: 'proj-e2e',
          runtime: 'codex',
          name: '会失败的任务',
          status: 'starting',
          headless: false,
          timeoutMinutes: 120,
          idleTimeoutSec: 1800,
          waitingInput: false,
          version: 1,
        },
      }),
    );
    // 刷新后这条 DTO 是唯一的真相来源：状态已 failed，且带码 + 自由文本细节。
    await page.route('**/api/sandboxes/sb-e2e-refresh', (route) =>
      route.fulfill({
        status: 200,
        json: {
          id: 'sb-e2e-refresh',
          projectId: 'proj-e2e',
          runtime: 'codex',
          name: '会失败的任务',
          status: 'failed',
          headless: false,
          timeoutMinutes: 120,
          idleTimeoutSec: 1800,
          waitingInput: false,
          version: 2,
          failureCode: 'IMAGE_CONTRACT_VIOLATION',
          failureMessage: 'command -v tmux exited 1',
        },
      }),
    );

    await page.goto('/');
    await page.getByRole('button', { name: /E2E 发起项目/ }).click();
    await expect(page.getByRole('radio', { name: /^aio/ })).toBeChecked();
    // provider 有 isDefault 会预选；runtime **不预选**，必须显式点一下。
    await page.getByRole('radio', { name: /^codex/ }).check();
    await page.getByRole('button', { name: '发起任务并打开终端' }).click();
    await expect(page.getByText('正在启动：会失败的任务')).toBeVisible();

    // ——— 刷新：内存里的 WS 状态全丢，只剩 persist 的 selectedSandboxId ———
    await page.reload();
    await page.getByRole('button', { name: /E2E 发起项目/ }).click();

    // 人话按码出（P22 §1），不给 [重试]，且自由文本细节原样展示。
    await expect(page.getByText(/缺少 tmux/)).toBeVisible();
    await expect(page.getByRole('button', { name: '换一张含 tmux 的镜像' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重试' })).toHaveCount(0);
    await expect(page.getByText('command -v tmux exited 1')).toBeVisible();
  });
});
