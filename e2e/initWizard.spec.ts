import { test, expect, type Page } from '@playwright/test';
import type { InitStatusDto, SystemResourcesDto, SystemSettingsDto } from '../src/types/system';
import type { ProjectDto } from '../src/types/project';
import type { SandboxDto } from '../src/types/sandbox';
import type { AuthChallenge, AuthStatusResponse, RuntimeDto } from '../src/types/runtimeCredential';
import { INITIALIZED_STATUS } from './initGate';
import type { DiagnoseServerFrame } from '../src/types/sse-protocol';
import { HEALTH_BODY } from './fixtures';

// F21-8 §7.4（本页独有补充场景 1/2/3 的可测部分）+ §9.2 VS-1 的真浏览器那一段。
// REST 用 `page.route`（E2E 层**不启 MSW**，12 §4.1：Service Worker 会让请求对 page.route 不可见）。
//
// ⚠️ 场景 3「离线模式下 [+ 新任务] 置灰」在本轮**测不了**：工作台侧的全局横幅与置灰
//    （`useGlobalBanner`）在本仓还不存在（F21-8 §4 把它列为本页对其它页面的唯一持续输出，
//    但那一半属于工作台）。⇒ 本文件只覆盖向导自己那一半，横幅那一条留给它落地时补。

const GB = 1024 ** 3;

const ONLINE: NonNullable<InitStatusDto['lastConnectivityCheck']> = [
  { target: 'api.anthropic.com', ok: true, latencyMs: 1925, modelApi: true },
  { target: 'api.openai.com', ok: true, latencyMs: 351, modelApi: true },
  { target: 'localhost:5001', ok: true, latencyMs: 6, modelApi: false },
];

const SETTINGS: SystemSettingsDto = {
  initialized: false,
  accessPasscodeEnabled: false,
  version: { platform: 'dev', node: 'v22.22.0' },
};

const RESOURCES: SystemResourcesDto = {
  cpu: { cores: 10, loadAvg1m: 3.7, usedPercent: 37, level: 'ok' },
  ram: { totalBytes: 32 * GB, usedBytes: 24 * GB, usedPercent: 76.7, level: 'ok' },
  disk: {
    path: '/data',
    totalBytes: 200 * GB,
    usedBytes: 120 * GB,
    availableBytes: 80 * GB,
    usedPercent: 60,
    level: 'ok',
    reservedPercent: 15,
  },
  retainedVolumes: { count: 0, totalBytes: 0, percentOfDisk: 0, level: 'ok', truncated: false },
  activeTasks: 0,
};

/**
 * 把一帧写成真的 SSE 段（`event:` 行 + `data:` 行 + 空行）。
 *
 * ⭐ 参数从 `Record<string, unknown>` 收成 `DiagnoseServerFrame`（29 §3.2）：那个宽签名
 * 让"少一个必填字段 / 用一个不存在的 check id / 写错 status"全都静默通过，而 SSE 帧是
 * **手抄跨仓**的一份（`sse-protocol.ts` 的 `SSE_PROTOCOL_CANONICAL` 就是为它加的门禁）。
 */
function sse(frame: DiagnoseServerFrame): string {
  return `event: ${frame.event}\ndata: ${JSON.stringify(frame)}\n\n`;
}

const DIAGNOSE_BODY = [
  sse({ event: 'start', checks: [], timeoutMs: 5000 }),
  sse({
    event: 'check',
    id: 'outbound-network',
    label: '外网连通（模型 API / 镜像仓库）',
    status: 'ok',
    summary: '均可达',
    detail: { results: ONLINE },
    durationMs: 293,
  }),
  sse({
    event: 'check',
    id: 'preset-image',
    label: '预制镜像就绪',
    status: 'ok',
    step: 'staged',
    summary: '预制镜像就绪：已注册、已在本机铺开',
    durationMs: 22,
  }),
  sse({ event: 'done', okCount: 2, infoCount: 0, warnCount: 0, failCount: 0, totalMs: 300 }),
].join('');

interface RouteOpts {
  /** 首次 `init-status` 的返回；`POST /init` 成功后自动切成 `initialized:true`。 */
  initialized?: boolean;
  /** Step4 的 runtime 列表；缺省 = 一个已配好的 codex。 */
  runtimes?: RuntimeDto[];
}

/** 记录每一次 `POST /api/system/init` 的请求体（断言"保存 ≠ 放行"用）。 */
const READY_CODEX: RuntimeDto = {
  id: 'codex',
  displayName: 'ChatGPT（Codex）',
  vendor: 'openai',
  authMethods: ['oauth-device', 'api-key'],
  credentialStatus: 'active',
  maskedIdentifier: 'a***@gmail.com',
  activeAuthMethod: 'account',
  credentials: [
    {
      credentialId: 'cred-1',
      mode: 'account',
      maskedIdentifier: 'a***@gmail.com',
      status: 'ok',
    },
  ],
};

async function routeInitApis(page: Page, opts: RouteOpts = {}): Promise<{ initCalls: number }> {
  const state = { initialized: opts.initialized ?? false, initCalls: 0 };

  await page.route('**/api/system/init-status', async (route) => {
    await route.fulfill({
      json: state.initialized
        ? INITIALIZED_STATUS
        : ({
            initialized: false,
            lastConnectivityCheck: ONLINE,
            lastConnectivityCheckAt: '2026-08-29T16:11:34.000Z',
          } satisfies InitStatusDto),
    });
  });
  await page.route('**/api/system/settings', async (route) => {
    await route.fulfill({ json: SETTINGS });
  });
  await page.route('**/api/system/resources', async (route) => {
    await route.fulfill({ json: RESOURCES });
  });
  await page.route('**/api/system/init', async (route) => {
    state.initCalls += 1;
    state.initialized = true;
    await route.fulfill({ status: 201, json: INITIALIZED_STATUS });
  });
  await page.route('**/api/system/diagnose', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-schema-hash': 'sb-diagnose-v1' },
      body: DIAGNOSE_BODY,
    });
  });
  // 工作台在放行之后会去拉这些；给空数据，让"工作台真的挂起来了"这件事可断言。
  await page.route('**/api/projects*', async (route) => {
    await route.fulfill({ json: [] satisfies ProjectDto[] });
  });
  await page.route('**/api/sandboxes*', async (route) => {
    await route.fulfill({ json: [] satisfies SandboxDto[] });
  });
  // Step4 订阅配置（v1.2）。⚠️ **默认给一份"已配好"的 codex**：这条用例走的是
  //「一路 [下一步] 到底」的常态路径，而空数组会命中「registry 一个 runtime 都没有」
  //   那个异常分支 —— 用异常态当常态背景，会让这条主链路的绿失去意义。
  //   ⚠️ 取值镜像：字段与真后端 `RuntimeResponseDto` 一一对应，`maskedIdentifier`
  //   照真实掩码形态写（⛔ 永不回显明文）。
  await page.route('**/api/runtimes*', async (route) => {
    await route.fulfill({ json: (opts.runtimes ?? [READY_CODEX]) satisfies RuntimeDto[] });
  });
  // ⚠️ `GET /api/health` 的契约响应**没有 body**（`content?: never`）——此前这里回的
  // `{ status: 'ok' }` 是替身自己造的一个字段，真后端上根本不存在（12 §3.4：值不能凭空）。
  await page.route('**/api/health*', async (route) => {
    await route.fulfill({ json: HEALTH_BODY });
  });

  return state;
}

test.describe('F21-8 · 首次冷启动的阻塞式向导', () => {
  test('场景 1：全新实例走完向导 ⇒ URL 仍是 `/`，工作台就地出现（不经中间空白页）', async ({
    page,
  }) => {
    const state = await routeInitApis(page);
    await page.goto('/');

    await expect(page.getByTestId('init-wizard')).toBeVisible();
    // 进向导直接渲染历史结果（不重跑），并带着它的时刻。
    await expect(page.getByTestId('connectivity-checked-at')).toContainText('上次检测');

    // 全通过 ⇒ 跳过代理那一步，直接到第 3 步。
    await page.getByRole('button', { name: '下一步' }).click();
    await expect(page.getByTestId('preset-image-check')).toBeVisible();
    await expect(page.getByTestId('preset-step-staged')).toHaveAttribute('data-state', 'pass');

    await page.getByRole('button', { name: '下一步' }).click();
    // Step4 订阅配置：已配好 ⇒ 就绪，按钮是 [下一步] 而不是 [稍后配置，下一步]。
    await expect(page.getByTestId('subscription-setup')).toHaveAttribute('data-ready', 'true');
    await page.getByRole('button', { name: '下一步' }).click();

    await expect(page.getByTestId('resource-confirm')).toBeVisible();
    await page.getByRole('button', { name: '确认，开始使用' }).click();

    await expect(page.getByTestId('init-wizard')).toHaveCount(0);
    // ⚠️ URL 全程没动过：拦截靠"不渲染"，不是 redirect（§2）。
    expect(new URL(page.url()).pathname).toBe('/');
    expect(state.initCalls).toBe(1);
  });

  test('场景 2：初始化完成后刷新 ⇒ 向导不再出现（一次性）', async ({ page }) => {
    await routeInitApis(page, { initialized: true });
    await page.goto('/');
    await expect(page.getByTestId('init-wizard')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('init-wizard')).toHaveCount(0);
  });

  test('⭐ 未初始化时的深链 `/settings/images` ⇒ 仍是向导，URL 不动（不做 redirect）', async ({
    page,
  }) => {
    await routeInitApis(page);
    await page.goto('/settings/images');

    await expect(page.getByTestId('init-wizard')).toBeVisible();
    // ⚠️ 两条否定断言：设置页的内容一点都不许渲染，而 URL 也不许被改写
    //    —— redirect 会让用户完成初始化后回不到他原本要去的地方。
    await expect(page.getByRole('heading', { name: '🖼️ 镜像管理' })).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/settings/images');
  });

  test('⭐ 阻塞语义：向导里没有 [取消]，按 Esc 也逃不掉', async ({ page }) => {
    await routeInitApis(page);
    await page.goto('/');
    await expect(page.getByTestId('init-wizard')).toBeVisible();

    await expect(page.getByRole('button', { name: '取消' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('init-wizard')).toBeVisible();
  });
});

// ————————————————————————————————————————————————————————————————
// Step4 · 订阅配置（v1.2，P21-8 §2 / §2.1）
// ————————————————————————————————————————————————————————————————

const EMPTY_CODEX: RuntimeDto = {
  ...READY_CODEX,
  credentialStatus: 'none',
  credentials: [],
};
const EMPTY_CLAUDE: RuntimeDto = {
  id: 'claude-code',
  displayName: 'Claude Code',
  vendor: 'anthropic',
  authMethods: ['setup-token', 'api-key'],
  credentialStatus: 'none',
  credentials: [],
};

/** 走到 Step4。 */
async function gotoSubscriptionStep(page: Page, runtimes: RuntimeDto[]): Promise<void> {
  await routeInitApis(page, { runtimes });
  await page.goto('/');
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByTestId('preset-image-check')).toBeVisible();
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByTestId('subscription-setup')).toBeVisible();
}

test.describe('F21-8 · Step4 订阅配置', () => {
  test('⛔ 判据是「至少一个可用」——一个配好、另一个空，照样放行', async ({ page }) => {
    await gotoSubscriptionStep(page, [READY_CODEX, EMPTY_CLAUDE]);
    await expect(page.getByTestId('subscription-setup')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByTestId('subscription-blocked')).toHaveCount(0);
    // 已配好的那行没有下一步，不给动作按钮。
    await expect(page.getByTestId('subscription-configure-codex')).toHaveCount(0);
    await expect(page.getByTestId('subscription-configure-claude-code')).toBeVisible();
    await expect(page.getByRole('button', { name: '下一步' })).toBeVisible();
  });

  test('全都没配 ⇒ 不阻塞但明示后果，按钮变 [稍后配置，下一步]', async ({ page }) => {
    await gotoSubscriptionStep(page, [EMPTY_CODEX, EMPTY_CLAUDE]);
    await expect(page.getByTestId('subscription-setup')).toHaveAttribute('data-ready', 'false');
    await expect(page.getByTestId('subscription-blocked')).toContainText('无法发起任何任务');
    // ⚠️ 不阻塞：这一步与 Step3 同一条口径，挡住的是同一件事。
    await page.getByRole('button', { name: '稍后配置，下一步' }).click();
    await expect(page.getByTestId('resource-confirm')).toBeVisible();
  });

  test('⭐ ChatGPT [打开授权页] ⇒ 真的开出一个新标签页，原页面留在这一步等结果', async ({
    page,
    context,
  }) => {
    // 设备码挑战替身（取值镜像：URL 与码的形态取自真实 CLI 输出 fixture）。
    await page.route('**/api/runtimes/codex/auth/begin', async (route) => {
      await route.fulfill({
        json: {
          // ⛔ 第一版这里写的是 `'oauth-device'` —— 那是 **method** 的取值，不是 `kind` 的。
          //    `kind` 的闭集是 `url | device-code | paste-prompt`。裸对象字面量时 TS 看不见，
          //    是**替身锚定门禁**（29 §3.2）逼出 `satisfies` 之后当场报出来的。
          kind: 'device-code',
          // ⚠️ `method` 与 `kind` 是**两个**字段：前者是「用哪种鉴权方式」，后者是
          //    「这一步在界面上长什么样」。第一版把它们混成了一个。
          method: 'oauth-device',
          // ⚠️ **取值镜像**：URL 与码的形态逐字取自真实 CLI 输出 fixture
          //    （api/packages/modules/runtime/test/fixtures/cli-output/codex/v0.43.1/
          //    device-auth.txt）——⛔ 不自己编一个好看的。
          verificationUrl: 'https://auth.openai.com/codex/device',
          userCode: 'ABCD-2WXYZ',
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          challengeRef: 'chal-1',
          instructions: '在打开的页面里输入设备码',
        } satisfies AuthChallenge,
      });
    });
    await page.route('**/api/runtimes/codex/auth/status', async (route) => {
      await route.fulfill({ json: { status: 'pending' } satisfies AuthStatusResponse });
    });

    await gotoSubscriptionStep(page, [EMPTY_CODEX]);
    await page.getByTestId('subscription-configure-codex').click();
    await expect(page.getByText('ABCD-2WXYZ')).toBeVisible();

    // ⭐ 这一条是本次改动的核心：点它**真的**开一个新标签页。
    // ⚠️ 用 context 的 'page' 事件接 —— `page.route` 拦不到 popup（本仓踩过：
    //    「Playwright route 不拦 popup」，点了开新标签页的用例替身失效却照样绿）。
    // ⛔ **必须用 `context.route` 拦住，不能让它真打到 openai.com。**
    //    ⚠️ `page.route` 拦不到 popup（本仓记过的坑：点了开新标签页的用例，替身失效却
    //    照样绿）——而这一次的表现更糟：第一版真连了外网，popup 被 OpenAI 重定向到
    //    `/log-in`，断言以一个看起来像 bug 的形式失败。**一条会打真实互联网的 e2e，
    //    慢、脆、还依赖别人的站在线。**
    const opened: string[] = [];
    await context.route('https://auth.openai.com/**', async (route) => {
      opened.push(route.request().url());
      await route.fulfill({ contentType: 'text/html', body: '<h1>stub auth page</h1>' });
    });

    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.getByTestId('open-auth-page').click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    // 断言的是**我们请求了哪个地址**，而不是它最终停在哪 —— 后者由对面的站决定。
    expect(opened).toContain('https://auth.openai.com/codex/device');
    await popup.close();

    // ⚠️ 原页面**留在这一步**等结果 —— 跨源，新标签页回不了话，成功只能靠本页轮询。
    await expect(page.getByTestId('subscription-setup')).toBeVisible();
  });
});
