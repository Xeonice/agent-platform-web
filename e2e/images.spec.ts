import { test, expect, type Page } from '@playwright/test';
import { stubInitialized } from './initGate';
import { stubHealth } from './fixtures';
import type { MaskedGitCredential } from '../src/types/gitCredential';
import type { RuntimeDto } from '../src/types/runtimeCredential';
import type {
  ImageManifestDto,
  RegisterImageResponseDto,
  ValidationOutcomeDto,
} from '../src/types/image';

// F21-4 §7.4 · 镜像管理 e2e（补上之前，它是八页里唯一没有 spec 的一页）。
//
// ── ⚠️ 这一层**只挑别的四层结构上做不到的事**，不重跑它们跑过的 ────────────────────
// `ImagesContainer.test.tsx` 已有 16 条集成（digest 未解析不撒谎 / [重新验证] 不换镜像 /
// 后端 400 逐行归位 / ❌ 无 [保存] / 预置镜像无 [删除] …），六份 stories 另有 36 个 play。
// 把它们在 Playwright 里再写一遍只会让同一件事有两个更慢的绿灯。本文件覆盖的是：
//   · **跨页**：设置菜单 → 镜像页（守 F21-4 §2「菜单没解禁 ⇒ 页面建好了也进不去」）、
//     子页互切后搜索词的生命周期；
//   · **真实地址栏**：`?filter=warning` 的深链初值走的是 `window.location`
//     （`useImages.ts:73`），container 那条只能在 jsdom 里**伪造** location；
//     ⚠️ 这里**没有** SSR/hydration 可验，理由写在用例 ② 里，别在那条上加装饰断言；
//   · **真实浏览器文档 + 真实 wire**：secret 红线断言的是整份 `page.content()` 与真的发出去
//     的那个请求体，而不是 React 渲染树。
//
// ── ⛔ §7.4 列的补充场景 2（注册后回工作台开向导、断言镜像出现在下拉）**本轮做不了** ──
// 向导今天**没有镜像下拉**：`NewSandboxPanel.view` 的 props 是 runtime / provider / 分支 /
// 指令，`ImageSelect` 全仓零文件、`selectableImages()` 零生产调用方。VS-1 的第 4/6 步
// （「出现在下拉」/「禁用后从下拉消失」）因此没有可断言的对象——**不写一条绕过它的替代用例**，
// 那只会让缺口看起来被补上了。缺口回填在 §7.4 与 §9.3。
//
// F21-8 §2：`AppBootGate` 挂在根布局上 ⇒ 每个用例都会先读一次 init-status（见 initGate.ts）。
test.beforeEach(async ({ page }) => {
  await stubInitialized(page);
});

/** ⚠️ 这是**替身故意漏掩码**回给前端的密文（理由见 `WARN_IMAGE` 上的注释）。 */
const SECRET_PLAINTEXT = 'sk-IMAGE-ENV-SUPERSECRET-0f1e2d3c4b5a';

const DIGEST_BUILTIN = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
const DIGEST_WARN = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';
const DIGEST_INVALID = 'sha256:3333333333333333333333333333333333333333333333333333333333333333';
const DIGEST_NEW = 'sha256:4444444444444444444444444444444444444444444444444444444444444444';
const DIGEST_BASE = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/**
 * ⭐ `satisfies ImageManifestDto` 不是装饰（29 §3.2 / `pnpm check:mock-contracts`）：
 * 这条 DTO 有 20 个必填字段，手写少一个（`derivedFromDigest` / `resolvedAt` 最容易漏）
 * 在编译期就是 TS1360，而不是等到某条用例恰好读到那一格才露头。
 */
function manifest(overrides: Partial<ImageManifestDto>): ImageManifestDto {
  return {
    id: 'm-x',
    imageId: 'img-x',
    imageName: 'docker.io/myrepo/ml-agent',
    isBuiltin: false,
    ref: 'docker.io/myrepo/ml-agent:v1.0',
    version: 'v1.0',
    baseImage: 'docker.io/myrepo/ml-agent',
    digest: DIGEST_WARN,
    entrypointContract: { workdir: '/workspace', entrypoint: ['/bin/sh'] },
    supportedRuntimes: ['codex'],
    resourceDefaults: { cores: 2, ramMb: 4096, diskMb: 20480 },
    labelsRequired: [],
    derivedFromDigest: DIGEST_BASE,
    validationStatus: 'valid',
    validationErrors: null,
    isActive: true,
    imageConfig: null,
    registeredAt: '2026-08-01T00:00:00.000Z',
    resolvedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** ✅ 预置 AIO（`isBuiltin` ⇒ 卡上没有 [删除]）。 */
const BUILTIN = manifest({
  id: 'm-builtin',
  imageId: 'img-builtin',
  imageName: 'ghcr.io/platform/aio',
  isBuiltin: true,
  ref: 'ghcr.io/platform/aio:1.4.0',
  version: '1.4.0',
  baseImage: 'ghcr.io/platform/aio',
  digest: DIGEST_BUILTIN,
  derivedFromDigest: null,
  supportedRuntimes: ['codex', 'claude-code'],
  registeredAt: '2026-08-03T00:00:00.000Z',
  resolvedAt: '2026-08-03T00:00:00.000Z',
});

/**
 * ⚠️ 档：未预装 claude-code。
 *
 * `imageConfig.env` 里那条 secret 的 `value` **故意是明文**——契约上 `value: string`
 * 允许任何串，而后端 I-IMG-5 保证它掩码成 `''`。这里替身**违反那条保证**，正是为了让
 * 「原值不进 DOM」这条断言有东西可漏：填 `''` 的话，"全文不含明文"由"根本没有明文"
 * 廉价满足，那条红线就成了一条永远绿的装饰（29 §3.5.2b 那个 `deny-loopback` 教训的同型）。
 */
const WARN_IMAGE = manifest({
  id: 'm-warn',
  imageId: 'img-warn',
  validationStatus: 'warning',
  validationErrors: [
    {
      code: 'RUNTIME_NOT_PREINSTALLED',
      message: '该镜像未预装 claude-code，创建时需现装，实测约 12.5 分钟。',
    },
  ],
  imageConfig: {
    env: [
      { key: 'LOG_LEVEL', value: 'info', secret: false },
      { key: 'MY_SECRET', value: SECRET_PLAINTEXT, secret: true },
    ],
  },
  registeredAt: '2026-08-02T00:00:00.000Z',
  resolvedAt: '2026-08-02T00:00:00.000Z',
});

/** ❌ 档：缺 tmux（04 §7 把 tmux 升成 MUST ⇒ 这一档从 ⚠️ 移到了 ❌）。 */
const INVALID_IMAGE = manifest({
  id: 'm-invalid',
  imageId: 'img-invalid',
  imageName: 'docker.io/myrepo/no-tmux',
  ref: 'docker.io/myrepo/no-tmux:v2',
  version: 'v2',
  baseImage: 'docker.io/myrepo/no-tmux',
  digest: DIGEST_INVALID,
  validationStatus: 'invalid',
  validationErrors: [{ code: 'IMAGE_TMUX_MISSING', message: '镜像缺少 tmux，不满足平台约定。' }],
  registeredAt: '2026-08-01T00:00:00.000Z',
  resolvedAt: '2026-08-01T00:00:00.000Z',
});

const LIST = [BUILTIN, WARN_IMAGE, INVALID_IMAGE] satisfies ImageManifestDto[];

/** ⚠️ 档的预检结论（`POST /api/images/validate`，**不落库**）。 */
const WARN_OUTCOME = {
  status: 'warning',
  errors: [],
  warnings: [
    {
      code: 'RUNTIME_NOT_PREINSTALLED',
      message: '该镜像未预装 claude-code，创建时需现装，实测约 12.5 分钟。',
    },
  ],
} satisfies ValidationOutcomeDto;

const NEW_MANIFEST = manifest({
  id: 'm-new',
  imageId: 'img-new',
  imageName: 'docker.io/myrepo/fresh',
  ref: 'docker.io/myrepo/fresh:v9',
  version: 'v9',
  baseImage: 'docker.io/myrepo/fresh',
  digest: DIGEST_NEW,
  validationStatus: 'warning',
  validationErrors: WARN_OUTCOME.warnings,
  registeredAt: '2026-08-10T00:00:00.000Z',
  resolvedAt: '2026-08-10T00:00:00.000Z',
});

const REGISTERED = {
  manifest: NEW_MANIFEST,
  validation: WARN_OUTCOME,
} satisfies RegisterImageResponseDto;

/** 重复粘贴同一个 URI：后端回 **200**（这个 digest 库里已经有了），body 与 201 一模一样。 */
const DUPLICATE = {
  manifest: WARN_IMAGE,
  validation: WARN_OUTCOME,
} satisfies RegisterImageResponseDto;

/**
 * `GET /api/images` 的替身，并把它被打过几次记下来。
 *
 * ⚠️ **`GET` 与注册用的 `POST` 是同一个 URL**，所以这里必须按 method 分流并对 POST
 * `route.fallback()`，让用例自己注册的 POST 替身接得住——否则「[保存] 打的到底是
 * `/api/images` 还是 `/api/images/validate`」这条断言会被这一层悄悄吃掉。
 */
async function stubImageList(page: Page, pages: ImageManifestDto[][]): Promise<() => number> {
  let n = 0;
  await page.route('**/api/images', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const body = pages[Math.min(n, pages.length - 1)] ?? [];
    n += 1;
    await route.fulfill({ json: body satisfies ImageManifestDto[] });
  });
  return () => n;
}

/** 凭证页（本文件只把它当"另一个设置子页"用，跨页导航的另一端）。 */
async function stubCredentialsPage(page: Page): Promise<void> {
  await page.route('**/api/credentials?*', (route) =>
    route.fulfill({ json: [] satisfies MaskedGitCredential[] }),
  );
  await page.route('**/api/runtimes', (route) =>
    route.fulfill({ json: [] satisfies RuntimeDto[] }),
  );
}

async function stubBase(page: Page, pages: ImageManifestDto[][]): Promise<() => number> {
  await stubHealth(page);
  await stubCredentialsPage(page);
  return stubImageList(page, pages);
}

/**
 * ⚠️ 卡上的 `data-image-id` 是**那一行 manifest 的 id**（`ImageCard.view` 收的
 * `ImageCardModel.id` 来自 `manifestToCardInput(dto).id = dto.id`），**不是** `imageId`。
 * 两者在本页很容易混：一张卡 = 一个 `imageId`，但卡面呈现的是它的**当前活行**。
 */
const card = (page: Page, manifestId: string) => page.locator(`[data-image-id="${manifestId}"]`);

test.describe('F21-4 镜像管理 · 跨页可达性', () => {
  test('① 设置菜单里的「镜像管理」真的进得去（F21-4 §2：菜单与子页必须同一轮解禁）', async ({
    page,
  }) => {
    await stubBase(page, [LIST]);

    await page.goto('/settings/credentials');
    const entry = page.getByRole('button', { name: '🖼️ 镜像管理' });
    // 守的正是那条退化：菜单项曾经挂着 `disabled: true`，页面建好了也进不去，
    // 而 container 测试直接渲染 `<ImagesContainer />`、根本不经过菜单，看不见这件事。
    await expect(entry).toBeEnabled();
    await entry.click();

    await expect(page).toHaveURL(/\/settings\/images$/);
    await expect(page.getByRole('heading', { name: '已注册的 OCI 镜像' })).toBeVisible();
    await expect(page.getByTestId('image-card')).toHaveCount(3);
    // 菜单项进入后处于选中态（aria-current），否则用户不知道自己在哪一页。
    await expect(entry).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('F21-4 镜像管理 · 深链（真实地址栏，§7.4 补充场景 1）', () => {
  test('② 外部粘进来的 `?filter=warning` 进入即只列 ⚠️；切回 [全部] 三张都在', async ({ page }) => {
    await stubBase(page, [LIST]);
    // 深链初值刻意读 `window.location` 而不是 `useSearchParams()`（`useImages.ts:73`），
    // container 集成那条用例只能在 jsdom 里**伪造** location；这一层走的是真的地址栏 +
    // 真的 Next 路由，验的是"把这条链接发给同事，他点开就是过滤后的样子"。
    //
    // ⚠️ **这里没有 SSR/hydration 风险可验，别在这条上加"无 hydration 报错"的断言**：
    // `AppBootGate` 在 init-status 落地前只渲染骨架（实测 SSR 出的 body 里连
    // 「已注册的 OCI 镜像」都没有），整棵子树**只在客户端挂载一次**，
    // 服务端那一趟根本没渲染过这个过滤器 ⇒ 那条断言不可能红，是一条装饰。
    await page.goto('/settings/images?filter=warning');

    // 正向证据：⚠️ 那张卡在，且过滤按钮处于按下态 —— 证明过滤器**真的被应用了**，
    // 下面两条"另外两张不在"才不是由"列表根本没渲染"廉价满足的。
    await expect(card(page, 'm-warn')).toBeVisible();
    const warnTab = page.getByRole('button', { name: '⚠️ 警告' });
    await expect(warnTab).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('image-card')).toHaveCount(1);
    await expect(card(page, 'm-builtin')).toHaveCount(0);
    await expect(card(page, 'm-invalid')).toHaveCount(0);

    // 少的那两张是**被过滤掉的**，不是"后端只回了一行"：切回 [全部] 它们必须原地出现。
    // （没有这一步，上面三条对"列表请求本身就返回了 1 行"同样成立。）
    await page.getByRole('button', { name: '全部' }).click();
    await expect(page.getByTestId('image-card')).toHaveCount(3);
    await expect(warnTab).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('F21-4 镜像管理 · 搜索词的生命周期（P21-4 §6：会话级）', () => {
  /** 输入搜索词并**证明它生效了**（收窄到 1 张）——这是后面两条否定断言的正向前提。 */
  async function searchNarrowsToOne(page: Page): Promise<void> {
    await page.getByLabel('搜索镜像').fill('no-tmux');
    await expect(page.getByTestId('image-card')).toHaveCount(1);
    await expect(card(page, 'm-invalid')).toBeVisible();
  }

  test('③ 切到另一个设置子页再切回来 ⇒ 搜索框已清空、全量列表回来', async ({ page }) => {
    await stubBase(page, [LIST]);
    await page.goto('/settings/images');
    await expect(page.getByTestId('image-card')).toHaveCount(3);
    await searchNarrowsToOne(page);

    await page.getByRole('button', { name: '🔐 凭证管理' }).click();
    await expect(page).toHaveURL(/\/settings\/credentials$/);
    await page.getByRole('button', { name: '🖼️ 镜像管理' }).click();
    await expect(page).toHaveURL(/\/settings\/images$/);

    await expect(page.getByLabel('搜索镜像')).toHaveValue('');
    await expect(page.getByTestId('image-card')).toHaveCount(3);
  });

  test('④ 刷新 ⇒ 搜索框为空；且 `localStorage.imageSearchQuery` 从头到尾没被写过', async ({
    page,
  }) => {
    await stubBase(page, [LIST]);
    await page.goto('/settings/images');
    await searchNarrowsToOne(page);
    // 上一行已经证明搜索词是**活的**（列表真的收窄了）⇒ 下面"没落盘"不是因为没搜过。
    expect(await page.evaluate(() => localStorage.getItem('imageSearchQuery'))).toBeNull();

    await page.reload();

    await expect(page.getByLabel('搜索镜像')).toHaveValue('');
    await expect(page.getByTestId('image-card')).toHaveCount(3);
    // P21-4 §6 要的三条是「会话内保留 + 切走即清 + 刷新不恢复」，而 localStorage 天生跨刷新。
    // 实现刻意没落这个键（`useImages.ts:243`）——半实现出来会在刷新后把上次的词填回去，
    // 与需求正好相反。这条断言把"没落"钉住。
    expect(await page.evaluate(() => localStorage.getItem('imageSearchQuery'))).toBeNull();
  });
});

test.describe('F21-4 镜像管理 · VS-2 secret 红线（真实浏览器文档 + 真实 wire）', () => {
  /** 打开 ⚠️ 那张卡的运行参数编辑器，并把真的发出去的 PATCH body 收下来。 */
  async function openEnvEditor(page: Page): Promise<{ patch: () => unknown }> {
    await stubBase(page, [LIST]);
    let patchBody: unknown = null;
    await page.route('**/api/images/m-warn', async (route) => {
      patchBody = route.request().postDataJSON();
      await route.fulfill({ json: WARN_IMAGE });
    });
    await page.goto('/settings/images');
    await card(page, 'm-warn').getByRole('button', { name: '编辑环境变量' }).click();
    return { patch: () => patchBody };
  }

  test('⑤ 已存 secret：输入框为空、整份文档不含密文；保存只发 imageConfig 一个字段', async ({
    page,
  }) => {
    const { patch } = await openEnvEditor(page);

    const editor = page.getByTestId('env-var-editor');
    // 正向证据：这一行**确实渲染出来了**（key 可见、placeholder 是"保持不变"那句），
    // 所以下面"文档全文不含密文"不是由"编辑器压根没打开"廉价满足的。
    await expect(editor.getByLabel('变量名 2')).toHaveValue('MY_SECRET');
    const secretValue = editor.getByLabel('变量值 2');
    await expect(secretValue).toHaveValue('');
    await expect(secretValue).toHaveAttribute('placeholder', '（保持不变，输入即覆盖）');
    // 卡面摘要也只给 `***`。
    await expect(card(page, 'm-warn').getByTestId('env-summary')).toContainText('MY_SECRET=***');

    // ⚠️ 替身**故意把明文回给了前端**（见 WARN_IMAGE 的注释）：这条断言检验的是
    // "即使后端漏了掩码，前端也不把它写进文档"。查的是整份 `page.content()`——
    // 包含 RSC flight 数据与所有 attribute，而不只是 React 渲染出的可见文本。
    expect(await page.content()).not.toContain(SECRET_PLAINTEXT);

    await page.getByRole('button', { name: '保存运行参数' }).click();
    await expect(page.getByText('运行参数已保存')).toBeVisible();

    const body = patch();
    // 正向证据：请求真的发出去了（下面几条否定/形状断言才不是对着 `null` 说话）。
    expect(body).not.toBeNull();
    // body 里**只有** `imageConfig`——带上 `isActive` 就会在保存环境变量时顺手改启停状态
    // （`image.service.ts` 纪律 ②）。
    expect(Object.keys(body as Record<string, unknown>)).toEqual(['imageConfig']);
    // 非 secret 行原样回传；secret 行的 `secret` 位不能在往返里丢（丢了就变成明文变量）。
    expect(body).toMatchObject({
      imageConfig: {
        env: [
          { key: 'LOG_LEVEL', value: 'info', secret: false },
          { key: 'MY_SECRET', secret: true },
        ],
      },
    });
  });

  // ⛔⛔ **已知缺陷，用 `test.fail()` 记录，不是用删断言掩盖。**
  //
  // `test.fail()` 的语义是「这条现在应当红」：它红 ⇒ CI 绿（缺陷仍在，账还挂着）；
  // 有人把缺陷修了 ⇒ 这条转绿 ⇒ Playwright 反过来判 **failed**（"expected to fail"），
  // 修的人当场被提示把这行注解摘掉。⇒ 缺口既不会拖红 CI，也不会被悄悄忘掉。
  //
  // ── 缺陷本身（VS-2 步骤 3/4 的前半句在实现上不成立）────────────────────────────
  // P21-4 §10.2 / F21-4 §9.2 VS-2 写的是「**原值不进 props**、不进 DOM」，而
  // `envRowsFromConfig()` 把后端回来的 `entry.value` **逐字放进了 `EnvVarRowModel.value`**，
  // 只是 `EnvVarEditor.view` 渲染时用 `masked ? '' : row.value` 把它遮住了 ——
  // **掩码只发生在显示层**。于是 `useImages.saveEnv()` 拼请求体时读的 `r.value` 是那份原值，
  // 「直接保存 ⇒ 传空 value（= 保持不变）」今天成立**只是因为后端按 I-IMG-5 回了 `''`**。
  //
  // ⚠️ 这也正是**为什么 container 那条同名用例（§7.3「直接保存 ⇒ 请求体传空 value」）看不见它**：
  // 它的夹具用的是后端掩码后的 `''`，于是"前端传了空"与"后端本来就给的空"两件事在那条
  // 用例里**不可区分**，断言恒真。本条把夹具换成"后端漏掩码"，两者才分得开。
  //
  // ⇒ 修法（归实现侧，测试 agent 不动）：`saveEnv()` 对 `secretStored === true` 的行发 `''`，
  //   或 `envRowsFromConfig()` 干脆不把 secret 的 value 放进模型。顺带把 `saveEnv` 里
  //   「原值从来没有进过 props，所以这里也拿不到」那句注释改掉——它今天是**假的**。
  test('⑤b 后端若漏掩码，前端会把密文原样回传（已知缺陷：掩码只在显示层）', async ({ page }) => {
    // ⚠️ 写在**用例体内第一行**：写在 describe 作用域会把整个 describe 都标成"应当红"，
    // 连上面那条真绿的 ⑤ 一起被反转。
    test.fail();
    const { patch } = await openEnvEditor(page);
    await expect(page.getByTestId('env-var-editor').getByLabel('变量值 2')).toHaveValue('');

    await page.getByRole('button', { name: '保存运行参数' }).click();
    await expect(page.getByText('运行参数已保存')).toBeVisible();

    // 期望：secret 行传空 = 保持不变（VS-2 步骤 4）。实际：原封不动把密文发了回去。
    expect(patch()).toEqual({
      imageConfig: {
        env: [
          { key: 'LOG_LEVEL', value: 'info', secret: false },
          { key: 'MY_SECRET', value: '', secret: true },
        ],
      },
    });
  });
});

test.describe('F21-4 镜像管理 · VS-1 注册闭环（可做的那一半）', () => {
  test('⑥ 注册 ⚠️ 镜像：[验证] 打预检端点、[保存] 打注册端点，列表随即新增该卡片', async ({
    page,
  }) => {
    // 第二次 GET（保存后 invalidate 触发的那次）多回一行。
    const listCalls = await stubBase(page, [LIST, [...LIST, NEW_MANIFEST]]);
    const hits: string[] = [];
    await page.route('**/api/images/validate', async (route) => {
      hits.push('preflight');
      await route.fulfill({ json: WARN_OUTCOME });
    });
    await page.route('**/api/images', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      hits.push('register');
      await route.fulfill({ status: 201, json: REGISTERED });
    });

    await page.goto('/settings/images');
    await page.getByRole('button', { name: '+ 注册新镜像' }).first().click();

    const dialog = page.getByRole('dialog', { name: '注册新镜像' });
    await expect(dialog).toBeVisible();
    // 焦点落在 URI 输入框：view 的 `autoFocus` 与 container 的 `useModalFocus` 在真实浏览器里
    // **同时**作用于这个弹层，两者打架（焦点被拉去别处）只有整页装配起来才看得见。
    // ⚠️ 变异验证的结论要照实说：**只拆掉其中一个这条仍然绿**（另一个接住了），
    // 两个一起拆才红。这是对的——它断言的是"焦点在输入框"这个性质，不是某一种实现。
    const uri = dialog.getByPlaceholder('docker.io/myrepo/ml-agent:v1.0');
    await expect(uri).toBeFocused();

    await uri.fill('docker.io/myrepo/fresh:v9');
    await dialog.getByRole('button', { name: '验证' }).click();

    // ⚠️ 档：后果说明就地可见，且 [保存] 可用（警告不阻断，P21-4 §5）。
    await expect(dialog.getByTestId('validation-result')).toHaveAttribute('data-status', 'warning');
    await expect(dialog.getByText('实测约 12.5 分钟')).toBeVisible();
    const save = dialog.getByRole('button', { name: '保存' });
    await expect(save).toBeEnabled();
    await save.click();

    // 弹窗收起 + 列表里出现新卡片（跨"弹窗 → 列表"的那一段：靠的是 invalidate 后重打 GET）。
    await expect(page.getByRole('dialog', { name: '注册新镜像' })).toHaveCount(0);
    await expect(card(page, 'm-new')).toBeVisible();
    await expect(page.getByTestId('image-card')).toHaveCount(4);
    expect(listCalls()).toBeGreaterThanOrEqual(2);

    // 审计 P1-3：两个 validate 端点不可互换。e2e 是唯一能看见"真的打了哪个 URL"的一层。
    expect(hits).toEqual(['preflight', 'register']);
  });

  test('⑦ 重复注册回 200 ⇒ 就地提示 + [定位到该镜像]（不当错误吓唬人，P21-4 §6）', async ({
    page,
  }) => {
    await stubBase(page, [LIST]);
    await page.route('**/api/images/validate', (route) => route.fulfill({ json: WARN_OUTCOME }));
    await page.route('**/api/images', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      // ⚠️ **200 不是 201**：这个 digest 库里已经有了。body 与 201 那条一模一样——
      // `created` 只能由状态码得到（后端刻意不把同一个事实放进 body 第二遍）。
      await route.fulfill({ status: 200, json: DUPLICATE });
    });

    await page.goto('/settings/images');
    await page.getByRole('button', { name: '+ 注册新镜像' }).first().click();
    const dialog = page.getByRole('dialog', { name: '注册新镜像' });
    await dialog.getByPlaceholder('docker.io/myrepo/ml-agent:v1.0').fill(WARN_IMAGE.ref);
    await dialog.getByRole('button', { name: '验证' }).click();
    await dialog.getByRole('button', { name: '保存' }).click();

    // 弹窗**留在原地**并就地说明——不是一条红色 toast，也不是"注册成功"。
    const hint = dialog.getByTestId('duplicate-hint');
    await expect(hint).toContainText('该镜像已注册');
    // 列表没有多出一张卡（后端说"这一行早就在库里了"，前端不该也插一张）。
    await expect(page.getByTestId('image-card')).toHaveCount(3);

    await hint.getByRole('button', { name: '定位到该镜像' }).click();
    await expect(page.getByRole('dialog', { name: '注册新镜像' })).toHaveCount(0);
    // 高亮落在**那一张**卡上（而不是随便一张 / 全部）。
    const slot = (manifestId: string) =>
      page.locator(`[data-testid="image-card-slot"]:has([data-image-id="${manifestId}"])`);
    await expect(slot('m-warn')).toHaveAttribute('data-highlighted', 'true');
    await expect(slot('m-builtin')).toHaveAttribute('data-highlighted', 'false');
    await expect(slot('m-invalid')).toHaveAttribute('data-highlighted', 'false');
  });
});
