import { test, expect } from '@playwright/test';
import { stubInitialized } from './initGate';
import { stubHealth } from './fixtures';
import type {
  GitTestResult,
  MaskedGitCredential,
  StoreGitCredentialResponse,
} from '../src/types/gitCredential';
import type { ProjectDto } from '../src/types/project';

// F21-8 §2：`AppBootGate` 挂在根布局上 ⇒ 每个用例挂载时都会先读一次
// `GET /api/system/init-status`。不 stub 它就等于让这些用例依赖"CI 里恰好没有后端"
// （见 `initGate.ts` 的说明）。
test.beforeEach(async ({ page }) => {
  await stubInitialized(page);
});

// S3 Git 私有仓凭证（mock 边界集成，12 §4.2）。REST 用 page.route（不启 MSW）。
// 覆盖：① 配置 HTTPS Token（选来源→加 host→测试→保存）+ 掩码断言（只显尾号，全文无完整 token）；
//       ② clone 权限失败 → 就地 [配置 Git 凭证] → 跳凭证页 → [重试克隆] → 回工作台 + 命中 retry-clone。

const FULL_TOKEN = 'ghp_SUPERSECRETtokenABCDEFGHIJKLMNOPQRSTab12';
const MASKED = 'ghp_…ab12';

/** 列表卡片（`GET /api/credentials` → MaskedGitCredentialResponseDto[]，明文永不回读）。 */
const SAVED_CARD = {
  id: 'gc-1',
  kind: 'git',
  type: 'https-token',
  maskedIdentifier: MASKED,
  platform: 'github',
  allowedHosts: ['github.com', 'git.internal.example.com'],
  createdAt: new Date().toISOString(),
} satisfies MaskedGitCredential;

/**
 * ⭐ **保存响应只有两个字段。**
 *
 * 这条 fixture 此前回的是一整张 `MaskedGitCredential` 卡片，而契约里
 * `POST /api/credentials/git` 的响应是 `StoreGitCredentialResponseDto = {id, maskedIdentifier}`
 * —— 替身比真后端多给了 5 个字段。前端今天不读它们（保存后走的是列表 refetch），
 * 所以没出事；但只要哪天有人顺手 `res.allowedHosts`，e2e 会照绿而真后端上是 `undefined`。
 * 挂上 `satisfies` 之后这种"替身比后端慷慨"的写法在编译期就被挡住（多一个字段也红）。
 */
const SAVE_RESPONSE = {
  id: 'gc-1',
  maskedIdentifier: MASKED,
} satisfies StoreGitCredentialResponse;

const TEST_OK = { ok: true } satisfies GitTestResult;

/** 权限失败的私有仓项目（`cloneErrorCode` 驱动"就地配置凭证"那条引导）。 */
const PERM_FAILED_PROJECT = {
  id: 'proj-perm',
  name: '私有仓项目',
  sourceType: 'git',
  cloneStatus: 'failed',
  cloneErrorCode: 'CLONE_FAILED_PERMISSION',
  taskCount: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} satisfies ProjectDto;

const RETRYING_PROJECT = {
  ...PERM_FAILED_PROJECT,
  cloneStatus: 'cloning',
  cloneErrorCode: null,
} satisfies ProjectDto;

test.describe('S3 Git 凭证', () => {
  test('配置 HTTPS Token → 选来源 → 加 host → 测试 → 保存；只显尾号，全文无完整 token', async ({
    page,
  }) => {
    await stubHealth(page);

    let saved = false;
    await page.route('**/api/credentials?*', (route) =>
      route.fulfill({
        status: 200,
        json: (saved ? [SAVED_CARD] : []) satisfies MaskedGitCredential[],
      }),
    );
    await page.route('**/api/credentials/git/test', (route) => route.fulfill({ json: TEST_OK }));
    await page.route('**/api/credentials/git', (route) => {
      saved = true;
      return route.fulfill({ status: 201, json: SAVE_RESPONSE });
    });

    await page.goto('/settings/credentials');

    await page.getByRole('button', { name: '配置 HTTPS Token' }).click();
    // GitHub 默认来源；加一个自建 host
    await page.getByPlaceholder('git.internal.example.com').fill('git.internal.example.com');
    await page.getByRole('button', { name: '添加 host' }).click();
    // 粘贴 token（password 输入框）
    await page.getByPlaceholder('ghp_…').fill(FULL_TOKEN);
    // 测试连接 → ✅
    await page.getByRole('button', { name: '测试连接' }).click();
    await expect(page.getByText('✅ 连接成功')).toBeVisible();
    // 保存 → 列表刷新，卡片显示尾号
    await page.getByRole('button', { name: '保存' }).click();

    await expect(page.getByText(MASKED)).toBeVisible();
    // 掩码红线：页面任何位置都无完整 token，且无「查看明文」入口
    expect(await page.content()).not.toContain(FULL_TOKEN);
    await expect(page.getByRole('button', { name: /查看明文/ })).toHaveCount(0);
  });

  test('clone 权限失败 → [配置 Git 凭证] → 跳凭证页 → [重试克隆] → 回工作台 + 命中 retry-clone', async ({
    page,
  }) => {
    await stubHealth(page);
    await page.route('**/api/credentials?*', (route) =>
      route.fulfill({ status: 200, json: [] satisfies MaskedGitCredential[] }),
    );
    await page.route('**/api/projects', (route) =>
      route.fulfill({ status: 200, json: [PERM_FAILED_PROJECT] satisfies ProjectDto[] }),
    );

    let retried = false;
    await page.route('**/api/projects/proj-perm/retry-clone', (route) => {
      retried = true;
      return route.fulfill({ status: 202, json: RETRYING_PROJECT });
    });

    await page.goto('/');
    await page.getByRole('button', { name: /私有仓项目/ }).click();

    // 权限类失败：就地引导 [配置 Git 凭证]
    await page.getByRole('button', { name: '配置 Git 凭证' }).click();
    await expect(page).toHaveURL(/\/settings\/credentials/);

    // 回程横幅 + [重试克隆]
    await expect(page.getByText(/为项目「私有仓项目」配置凭证后/)).toBeVisible();
    await page.getByRole('button', { name: '重试克隆' }).click();

    await expect(page).toHaveURL(/\/$/);
    expect(retried).toBe(true);
  });
});
