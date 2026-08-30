import { test, expect } from '@playwright/test';
import type { SandboxDto, SandboxProviderCapabilities } from '../src/types/sandbox';
import type { RuntimeDto } from '../src/types/runtimeCredential';
import { stubInitialized } from './initGate';

// F21-8 §2：`AppBootGate` 挂在根布局上 ⇒ 每个用例挂载时都会先读一次
// `GET /api/system/init-status`。不 stub 它就等于让这些用例依赖"CI 里恰好没有后端"
// （见 `initGate.ts` 的说明）。
test.beforeEach(async ({ page }) => {
  await stubInitialized(page);
});

/**
 * provider 能力位 fixture（默认全开，按需覆盖）。
 *
 * ⚠️ **这是一份"形状"替身，不是对 aio / boxlite 真实能力位的声称。** 前端今天只读两位
 * （`spawnTty` 决定终端入口、`headlessTask` 决定无头入口），其余五位没有任何 UI 读它们，
 * 每条用例按自己要走的分支挑值即可。真实能力位的唯一一份镜像在 `src/mocks/handlers.ts`
 * 的 `PROVIDER_REGISTRY`（逐位抄自后端两个 provider 类），需要对照后端时看那里。
 */
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

/** runtime 注册表 fixture：id 取自后端 `{codex,claude-code}.adapter.ts` 的 `readonly id`。 */
function runtimeDto(overrides: Partial<RuntimeDto> & Pick<RuntimeDto, 'id'>): RuntimeDto {
  return {
    displayName: overrides.id,
    vendor: 'ACME',
    authMethods: ['api-key'],
    // ⚠️ 取 **active**（已配好凭证的常态），不是 'none'。
    // 鉴权拦截层（P20 §5.1）按这一位三分支判定：`none`/`expired` 会出闸门并**禁用
    // 发起按钮**。此前这里填 'none' 无所谓——那时前端根本不读这一位；现在它承重，
    // 替身就必须是"发起链路走得通"的那个值，否则每一条无关用例都被闸门拦住。
    // 凭证状态本身的用例在 `runtimeCredentials.spec.ts`，那里才该覆盖 none/expired。
    credentialStatus: 'active',
    maskedIdentifier: 'a***@example.com',
    credentials: [],
    ...overrides,
  };
}

const RUNTIMES: RuntimeDto[] = [
  runtimeDto({ id: 'codex', displayName: 'Codex', vendor: 'OpenAI' }),
  runtimeDto({ id: 'claude-code', displayName: 'Claude Code', vendor: 'Anthropic' }),
  runtimeDto({ id: 'acme-agent', displayName: 'Acme Agent' }),
];

const SANDBOX: SandboxDto = {
  id: 'sb-e2e',
  projectId: 'proj-e2e',
  runtime: 'claude-code',
  provider: 'boxlite',
  name: 'E2E 冒烟任务',
  status: 'running',
  headless: false,
  timeoutMinutes: 120,
  idleTimeoutSec: 1800,
  waitingInput: false,
  version: 1,
};

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

    // provider registry（GET /api/providers → ProviderResponseDto[]）：e2e 跑生产构建
    // （不启 MSW），故显式 stub。默认档由数组项的 isDefault 标记（无顶层字段）。
    // ⚠️ 这里仍然给三项（含第三方 acme），但**不再是"用例断言它出现在选项里"**——
    // 「运行档位」单选已删，界面上根本不列 provider。三项留着是为了让下面那条
    // 「单选组不存在」的断言有分量：registry 里有几项跟界面上出不出现选项，已经解耦了。
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

    // runtime 同样由服务端 registry 驱动（GET /api/runtimes）：值取后端两个内置 adapter 的真实 id
    // （12 §3.4：替身的值不能凭空），并额外带一个第三方 runtime 验证"前端零改动即多一项"。
    await page.route('**/api/runtimes', (route) => route.fulfill({ status: 200, json: RUNTIMES }));

    // 建沙箱请求体留一份：下面要证明前端**没把 provider 写进去**（见 ② ）。
    let createBody: Record<string, unknown> | undefined;
    await page.route('**/api/sandboxes', async (route) => {
      createBody = route.request().postDataJSON() as Record<string, unknown>;
      // 显式标注 SandboxDto：DTO 加必填字段时这里编译期红，而不是替身静默少一个字段。
      await route.fulfill({ status: 201, json: SANDBOX });
    });

    await page.goto('/');
    await expect(page.getByText('Agent 管理平台')).toBeVisible();

    // S2：先在项目树里选中 ready 项目（selectedReady 门）。
    await page.getByRole('button', { name: /E2E 冒烟项目/ }).click();

    // ⚠️ 面板**不再自己出现**（F21-2 §N.0）：它此前由 `sandboxId===null` 兜底渲染，
    // 现在必须点 [＋ 新任务] 打开一个真弹层。这一步本身就是"创建成了一个动作"的证据。
    await page.getByTestId('new-task-entry').click();
    await expect(page.getByTestId('modal-new-task')).toBeVisible();

    // ⚠️ runtime 单选**按 fieldset 作用域**取，不靠正则区分：这份替身里 runtime 有个
    // `acme-agent`，将来别处再冒出一个同前缀的 id，一个 /acme/ 就会命中两个而触发 strict
    // 违规。收紧正则只是把眼前这次撞车躲开，按组取则结构上不可能撞。
    const runtimes = page.getByRole('group', { name: /运行时/ });

    // ① **「运行档位 (provider)」单选组已删，这里断言它不存在。**
    //    `AioSandboxProvider extends DockerContainerBackend` —— aio 就是 docker 容器；
    //    boxlite 是微 VM（macOS 上走 Apple Hypervisor.framework）。哪个跑得起来是**宿主
    //    平台的事实**，不是用户偏好：Mac 上让人选 aio，只会撞上「没有 Docker」，而报出来
    //    的错还是「镜像尚未注册」，指不到真原因。选择权因此收回后端
    //    （`provider-registry.ts` 的 `hostPreferredProvider()`：macOS→boxlite / Linux→aio）。
    //
    //    这条断言写成"不存在"而不是删掉了事：**删掉等于以后谁把单选加回来都没人拦**，
    //    而加回来正是这次要防的那件事。上面的替身仍然给三个 provider（含第三方 acme）——
    //    正好证明"registry 里有几项"跟"界面上出不出现选项"已经解耦了。
    //    变异：把 `NewSandboxPanel.view.tsx` 里那组单选加回来 ⇒ 这条红。
    await expect(page.getByRole('group', { name: /运行档位/ })).toHaveCount(0);

    // runtime 一侧**不同判据**：平台没有「默认 runtime」概念（04 §8）⇒ 必选、不预选。
    // 一个都不该被选中，按钮此刻禁着；第三方 runtime 仍然无需改前端代码即出现在选项里。
    await expect(runtimes.getByRole('radio', { name: /^codex/ })).not.toBeChecked();
    await expect(runtimes.getByRole('radio', { name: /acme-agent/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '发起任务并打开终端' })).toBeDisabled();
    await runtimes.getByRole('radio', { name: /claude-code/ }).check();

    await page.getByRole('button', { name: '发起任务并打开终端' }).click();

    // ② **请求体里不许有 provider。** 上面那条只说明界面上没得选；这条说明前端连一个
    //    "顺手带上的默认值"都没有——"跑哪个档位"全世界只有后端一个知情者。
    //    此前这里是 `providers.getByRole('radio', {name:/boxlite/}).check()`（"改选 boxlite
    //    证明可选档"），那句现在描述的是一个已被撤销的产品决定。
    //    变异：让 container 在 createSandbox 的 body 里带上 `provider` ⇒ 这条红。
    await expect.poll(() => createBody).toBeDefined();
    expect(createBody).not.toHaveProperty('provider');

    // 终端容器挂载（xterm）+ 连接状态条出现（无真后端时为连接中/重连中）
    await expect(page.getByTestId('terminal-container')).toBeVisible();
    await expect(page.getByRole('status')).toBeVisible();
  });
});
