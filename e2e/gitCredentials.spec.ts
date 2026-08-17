import { test, expect } from '@playwright/test';

// S3 Git 私有仓凭证（mock 边界集成，12 §4.2）。REST 用 page.route（不启 MSW）。
// 覆盖：① 配置 HTTPS Token（选来源→加 host→测试→保存）+ 掩码断言（只显尾号，全文无完整 token）；
//       ② clone 权限失败 → 就地 [配置 Git 凭证] → 跳凭证页 → [重试克隆] → 回工作台 + 命中 retry-clone。

const FULL_TOKEN = 'ghp_SUPERSECRETtokenABCDEFGHIJKLMNOPQRSTab12';
const MASKED = 'ghp_…ab12';

test.describe('S3 Git 凭证', () => {
  test('配置 HTTPS Token → 选来源 → 加 host → 测试 → 保存；只显尾号，全文无完整 token', async ({
    page,
  }) => {
    await page.route('**/api/health', (route) => route.fulfill({ json: {} }));

    let saved = false;
    await page.route('**/api/credentials?*', (route) =>
      route.fulfill({
        status: 200,
        json: saved
          ? [
              {
                id: 'gc-1',
                kind: 'git',
                type: 'https-token',
                maskedIdentifier: MASKED,
                platform: 'github',
                allowedHosts: ['github.com', 'git.internal.example.com'],
                createdAt: new Date().toISOString(),
              },
            ]
          : [],
      }),
    );
    await page.route('**/api/credentials/git/test', (route) =>
      route.fulfill({ json: { ok: true } }),
    );
    await page.route('**/api/credentials/git', (route) => {
      saved = true;
      return route.fulfill({
        status: 201,
        json: {
          id: 'gc-1',
          kind: 'git',
          type: 'https-token',
          maskedIdentifier: MASKED,
          platform: 'github',
          allowedHosts: ['github.com', 'git.internal.example.com'],
          createdAt: new Date().toISOString(),
        },
      });
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
    await page.route('**/api/health', (route) => route.fulfill({ json: {} }));
    await page.route('**/api/credentials?*', (route) => route.fulfill({ status: 200, json: [] }));
    await page.route('**/api/projects', (route) =>
      route.fulfill({
        status: 200,
        json: [
          {
            id: 'proj-perm',
            name: '私有仓项目',
            sourceType: 'git',
            cloneStatus: 'failed',
            cloneErrorCode: 'CLONE_FAILED_PERMISSION',
            taskCount: 0,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );

    let retried = false;
    await page.route('**/api/projects/proj-perm/retry-clone', (route) => {
      retried = true;
      return route.fulfill({
        status: 202,
        json: {
          id: 'proj-perm',
          name: '私有仓项目',
          sourceType: 'git',
          cloneStatus: 'cloning',
          cloneErrorCode: null,
          taskCount: 0,
          createdAt: new Date().toISOString(),
        },
      });
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
