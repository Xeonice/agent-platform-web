import { test, expect, type Page } from '@playwright/test';
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
    // ⚠️ 取 **active**（已配好凭证的常态），不是 'none'。
    // 鉴权拦截层（P20 §5.1）按这一位三分支判定：`none`/`expired` 会出闸门并**禁用
    // 发起按钮**。此前这里填 'none' 无所谓——那时前端根本不读这一位；现在它承重，
    // 替身就必须是"发起链路走得通"的那个值，否则每一条无关用例都被闸门拦住。
    // 凭证状态本身的用例在 `runtimeCredentials.spec.ts`，那里才该覆盖 none/expired。
    credentialStatus: 'active',
    maskedIdentifier: 'a***@example.com',
    credentials: [],
  },
];

const PROMPT = '分析 /srv/internal-repo 的架构并输出摘要';

/**
 * 打开「新建任务」弹层。
 *
 * ⚠️ 这个 helper 本身就是本轮改造的证据（F21-2 §N.0）：面板此前由
 * `sandboxId===null || socketConfig===null` **兜底渲染**——不打开它、它自己就在，
 * 于是"创建"根本不是一个动作。现在它必须被 [＋ 新任务] 打开。
 */
async function openNewTaskModal(page: Page): Promise<void> {
  await page.getByTestId('new-task-entry').click();
  await expect(page.getByTestId('modal-new-task')).toBeVisible();
}

/** 一个 ready 的 git 项目（分支选择器要它是 git 项目才渲染）。 */
function gitProject(): Record<string, unknown> {
  return {
    id: 'proj-e2e',
    name: 'E2E 发起项目',
    sourceType: 'git',
    cloneStatus: 'ready',
    cloneErrorCode: null,
    taskCount: 0,
    createdAt: new Date().toISOString(),
    repoUrl: 'https://github.com/acme/e2e.git',
    repoBranch: 'main',
    baselineSizeBytes: 12_582_912,
    updatedAt: new Date().toISOString(),
  };
}

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
    await openNewTaskModal(page);

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
    await openNewTaskModal(page);
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
    await openNewTaskModal(page);
    await expect(page.getByRole('radio', { name: /^aio/ })).toBeChecked();
    // provider 有 isDefault 会预选；runtime **不预选**，必须显式点一下。
    await page.getByRole('radio', { name: /^codex/ }).check();
    await page.getByRole('button', { name: '发起任务并打开终端' }).click();
    await expect(page.getByText('正在启动：会失败的任务')).toBeVisible();

    // ——— 刷新：内存里的 WS 状态全丢，只剩 persist 的 selectedSandboxId ———
    // ⚠️ 刷新后**不再开弹层**：失败卡在主区，弹层是关着的（§9.1 #32 刷新即关闭弹窗）。
    await page.reload();
    await page.getByRole('button', { name: /E2E 发起项目/ }).click();

    // 人话按码出（P22 §1），不给 [重试]，且自由文本细节原样展示。
    await expect(page.getByText(/缺少 tmux/)).toBeVisible();
    await expect(page.getByRole('button', { name: '换一张含 tmux 的镜像' })).toBeVisible();
    await expect(page.getByRole('button', { name: '重试' })).toHaveCount(0);
    await expect(page.getByText('command -v tmux exited 1')).toBeVisible();
  });
});

// ————————————————————————————————————————————————————————————————
// ★ 本轮新增（F21-2 §7.4）：入口 / 形态对称 / 分支贯通 / 建完是详情
// ————————————————————————————————————————————————————————————————
test.describe('★ 新建任务：入口、弹层形态、分支、建完后的形态', () => {
  /** 四条新用例的共同 stub（都要一个 ready 的 git 项目 + 两个 registry）。 */
  async function stubBase(page: Page, branches: string[] = ['main', 'develop', 'feature/x']) {
    await page.route('**/api/health', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/projects', (route) =>
      route.fulfill({ status: 200, json: [gitProject()] }),
    );
    await page.route('**/api/projects/*/branches', (route) =>
      route.fulfill({ status: 200, json: branches }),
    );
    await page.route('**/api/providers', (route) =>
      route.fulfill({
        status: 200,
        json: [
          { name: 'aio', capabilities: providerCaps({ headlessTask: true }), isDefault: true },
        ],
      }),
    );
    await page.route('**/api/runtimes', (route) => route.fulfill({ status: 200, json: RUNTIMES }));
  }

  /**
   * ① **入口存在性**（§9.1 #1，最要紧的一条）。
   *
   * 今天没有任何入口——"新建任务"只是沙箱为空时的兜底态。**这条用例存在本身**
   * 就是"它变成了一个动作"的证据。
   *
   * 变异：删掉 `WorkbenchShell.view` 里的 [＋ 新任务] 按钮 ⇒ 本例变红。
   */
  test('① 工作台点 [＋ 新任务] → 弹窗打开；没选项目时入口禁用', async ({ page }) => {
    await stubBase(page);
    await page.goto('/');

    // 还没选项目 ⇒ 入口禁着（§9.1 #33：绕过会建出无项目归属的 Task）。
    await expect(page.getByTestId('new-task-entry')).toBeDisabled();
    await expect(page.getByTestId('modal-new-task')).toHaveCount(0);

    await page.getByRole('button', { name: /E2E 发起项目/ }).click();
    await expect(page.getByTestId('new-task-entry')).toBeEnabled();
    await page.getByTestId('new-task-entry').click();

    const modal = page.getByTestId('modal-new-task');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('role', 'dialog');
    // 弹窗继承树上选中的项目（§9.1 #3：弹窗内没有项目下拉）。
    await expect(modal.getByText(/在「E2E 发起项目」中发起/)).toBeVisible();
  });

  /**
   * ② **两个弹窗形态对称**（§9.1 #2）：都是 overlay（role=dialog）、Esc 都能关、都不改路由。
   *
   * 变异：把「新建项目」改回 return 成主区内容（去掉 ModalShell）⇒ 本例变红。
   */
  test('② 新建项目 / 新建任务：都是 overlay、Esc 都能关、都不改路由', async ({ page }) => {
    await stubBase(page);
    await page.goto('/');
    const url = page.url();

    // —— 新建项目 ——
    await page.getByRole('button', { name: /新建项目/ }).click();
    const projectModal = page.getByTestId('modal-new-project');
    await expect(projectModal).toBeVisible();
    await expect(projectModal).toHaveAttribute('aria-modal', 'true');
    // 弹层是**盖上去**的，主区（项目树）还在。
    await expect(page.getByLabel('项目分组任务树')).toBeVisible();
    expect(page.url()).toBe(url);
    await page.keyboard.press('Escape');
    await expect(projectModal).toHaveCount(0);

    // —— 新建任务 ——
    await page.getByRole('button', { name: /E2E 发起项目/ }).click();
    await page.getByTestId('new-task-entry').click();
    const taskModal = page.getByTestId('modal-new-task');
    await expect(taskModal).toBeVisible();
    await expect(taskModal).toHaveAttribute('aria-modal', 'true');
    expect(page.url()).toBe(url);
    await page.keyboard.press('Escape');
    await expect(taskModal).toHaveCount(0);
  });

  /**
   * ③ **分支贯通（前端一侧）**：选项来自 `GET /api/projects/:id/branches`，
   * 选了就进请求体、不选就**不进**。
   *
   * ⚠️ 文档的 VS-3 步骤 4 要断言容器内 `git rev-parse --abbrev-ref HEAD` = 所选分支，
   * 那需要**真后端 + 真容器**（浅克隆下必红），mock 边界的 e2e 做不到 —— 这里覆盖到
   * "前端把用户的选择原样交给后端"为止，容器内那一半留给联调（见报告）。
   *
   * 变异：在 handleCreate 里给 branch 补一个默认值（`branch || 'main'`）⇒ 「不选不传」那半变红。
   */
  test('③ 分支：选了进请求体 branch；不选则请求体不含 branch', async ({ page }) => {
    await stubBase(page);
    let body: Record<string, unknown> = {};
    await page.route('**/api/sandboxes', async (route) => {
      const raw: unknown = route.request().postDataJSON();
      body = typeof raw === 'object' && raw !== null ? Object.fromEntries(Object.entries(raw)) : {};
      await route.fulfill({
        status: 201,
        json: {
          id: 'sb-branch',
          projectId: 'proj-e2e',
          runtime: 'codex',
          provider: 'aio',
          name: '分支任务',
          status: 'creating',
          headless: false,
          timeoutMinutes: 120,
          idleTimeoutSec: 1800,
          waitingInput: false,
          version: 1,
        },
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: /E2E 发起项目/ }).click();
    await openNewTaskModal(page);

    // 选项来自后端（读的是本地引用，不触网）；缺省项 = 跟随基线当前分支。
    const branchSelect = page.getByLabel('分支（可选）');
    await expect(branchSelect).toBeVisible();
    await expect(branchSelect).toHaveValue('');
    await expect(branchSelect.getByRole('option', { name: 'feature/x' })).toHaveCount(1);

    // —— 不选：请求体不含 branch ——
    await page.getByRole('radio', { name: /^codex/ }).check();
    await page.getByRole('button', { name: '发起任务并打开终端' }).click();
    await expect.poll(() => Object.keys(body)).toContain('projectId');
    expect(body).not.toHaveProperty('branch');

    // —— 再来一次，这次选 feature/x ——
    body = {};
    await page.getByTestId('new-task-entry').click();
    await page.getByLabel('分支（可选）').selectOption('feature/x');
    await page.getByRole('radio', { name: /^codex/ }).check();
    await page.getByRole('button', { name: '发起任务并打开终端' }).click();
    await expect.poll(() => body['branch']).toBe('feature/x');
  });

  /**
   * ③b **空项目不渲染分支选择器**（§9.1 #17）：没有 git，谈不上分支。
   * 变异：把 `showBranchPicker={isGitProject}` 改成恒 true ⇒ 本例变红。
   */
  test('③b 空项目 ⇒ 弹窗内没有分支选择器', async ({ page }) => {
    await page.route('**/api/health', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/projects', (route) =>
      route.fulfill({
        status: 200,
        json: [{ ...gitProject(), sourceType: 'empty', repoUrl: undefined }],
      }),
    );
    await page.route('**/api/providers', (route) =>
      route.fulfill({
        status: 200,
        json: [{ name: 'aio', capabilities: providerCaps(), isDefault: true }],
      }),
    );
    await page.route('**/api/runtimes', (route) => route.fulfill({ status: 200, json: RUNTIMES }));

    await page.goto('/');
    await page.getByRole('button', { name: /E2E 发起项目/ }).click();
    await openNewTaskModal(page);

    await expect(page.getByTestId('branch-picker')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '发起任务并打开终端' })).toBeVisible();
  });

  /**
   * ④ **建完任务后是详情，不是发起表单**（§9.1 #34 / §N.3）。
   *
   * 变异：把 `HeadlessTaskContainer` 的分叉条件从 `taskId===null && !composing`
   * 改回 `taskId===null`（即"详情态也渲染 textarea"）⇒ 本例第一条断言变红。
   */
  test('④ 沙箱有任务 ⇒ 只读详情 + [新任务] 入口（不是一张空的发起表单）', async ({ page }) => {
    await stubBase(page);
    await page.route('**/api/sandboxes', (route) =>
      route.fulfill({
        status: 201,
        json: {
          id: 'sb-detail',
          projectId: 'proj-e2e',
          runtime: 'codex',
          provider: 'aio',
          name: '已完成的任务',
          status: 'running',
          // ★ 无头面板**只挂无头沙箱**：交互式沙箱底下挂一条「无头任务」会永远停在
          // 空态说"还没有任务"，而左侧树同时写着 `项目 · 1`——界面上两个东西都叫"任务"
          // （树数 Sandbox、面板数 AgentTask），同屏就打架。
          headless: true,
          timeoutMinutes: 120,
          idleTimeoutSec: 1800,
          waitingInput: false,
          version: 1,
        },
      }),
    );
    // 这个沙箱下已经有一条**跑完的**任务 ⇒ 面板该是只读详情。
    await page.route('**/api/sandboxes/*/tasks', (route) =>
      route.fulfill({
        status: 200,
        json: [
          {
            id: 'task-done',
            sandboxId: 'sb-detail',
            runtime: 'codex',
            status: 'succeeded',
            exitCode: 0,
            timeoutMinutes: 120,
            lastSeq: 9,
            artifacts: [{ name: 'report.md', size: 2048, modifiedAt: new Date().toISOString() }],
            startedAt: '2026-08-22T00:00:00.000Z',
            finishedAt: '2026-08-22T00:03:21.000Z',
          },
        ],
      }),
    );

    await page.goto('/');
    await page.getByRole('button', { name: /E2E 发起项目/ }).click();
    await openNewTaskModal(page);
    await page.getByRole('radio', { name: /^codex/ }).check();
    await page.getByRole('button', { name: '发起任务并打开终端' }).click();

    const detail = page.getByTestId('headless-task-detail');
    await expect(detail).toBeVisible();
    // ① 详情态**没有**指令 textarea（它正是被替换掉的东西）。
    await expect(page.getByLabel('任务指令')).toHaveCount(0);
    await expect(detail.getByTestId('detail-exit-code')).toHaveText('0');
    await expect(detail.getByText(/report\.md/)).toBeVisible();
    // ② [新任务] 入口**必须在**：一个沙箱多个任务是数据模型本来的样子，
    //    "建完就没有发起入口"会把多任务能力从界面上抹掉。
    await expect(detail.getByRole('button', { name: '发起无头运行' })).toBeEnabled();
    await detail.getByRole('button', { name: '发起无头运行' }).click();
    await expect(page.getByLabel('任务指令')).toBeVisible();
  });

  /**
   * ⑤ **项目只读条**（F21-6 §9.2/§9.3）：主区顶部四格 + [重新同步]，不新开页面。
   * 变异：把 `canSync` 改成恒真（克隆中也给同步入口）⇒ 需配合另一条 fixture；
   * 本例的变异是删掉只读条的渲染 ⇒ 四格断言全红。
   */
  test('⑤ 项目只读条：远端/分支/基线/最后同步 + [重新同步] 调 POST /sync', async ({ page }) => {
    await stubBase(page);
    let syncHits = 0;
    await page.route('**/api/projects/*/sync', async (route) => {
      syncHits += 1;
      await route.fulfill({ status: 204, body: '' });
    });

    await page.goto('/');
    await page.getByRole('button', { name: /E2E 发起项目/ }).click();

    const bar = page.getByTestId('project-info-bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByText('https://github.com/acme/e2e.git')).toBeVisible();
    await expect(bar.getByText('main')).toBeVisible();
    await expect(bar.getByText('12 MB')).toBeVisible();
    await expect(bar.getByText('最后同步')).toBeVisible();

    await bar.getByRole('button', { name: '重新同步' }).click();
    await expect.poll(() => syncHits).toBe(1);
  });
});
