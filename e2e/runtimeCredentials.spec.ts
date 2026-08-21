import { test, expect, type Page } from '@playwright/test';

// S4 Runtime 鉴权 UI（mock 边界集成，12 §4.2 用例组 B）。REST 用 page.route（不启 MSW）。
// 覆盖：① device-code 分支展示 + 轮询；② setup-token 粘贴；③ api-key 保存（掩码）；④ 吊销确认文案含「重启/无法追回」。

const FULL_KEY = 'sk-SUPERSECRETapikeyABCDEFGHIJKLMNOPqrstuvwx';

/** 通用桩：health + git 空列表 + runtimes（codex 帐号授权生效 / claude-code 未配置）。 */
async function stubBase(page: Page): Promise<void> {
  await page.route('**/api/health', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/credentials?*', (route) => route.fulfill({ status: 200, json: [] }));
  await page.route('**/api/runtimes', (route) =>
    route.fulfill({
      status: 200,
      json: [
        {
          id: 'codex',
          displayName: 'Codex',
          vendor: 'OpenAI',
          authMethods: ['oauth-device', 'api-key'],
          credentialStatus: 'active',
          maskedIdentifier: 'a***@gmail.com',
          expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
          activeAuthMethod: 'account',
          credentials: [
            {
              credentialId: 'rc-codex-account',
              mode: 'account',
              maskedIdentifier: 'a***@gmail.com',
              status: 'ok',
              expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
            },
          ],
        },
        {
          id: 'claude-code',
          displayName: 'Claude Code',
          vendor: 'Anthropic',
          authMethods: ['setup-token', 'api-key'],
          credentialStatus: 'none',
          credentials: [],
        },
      ],
    }),
  );
}

test.describe('S4 Runtime 鉴权 UI', () => {
  test('① device-code：[重新授权] → 展示设备码 + 倒计时，轮询到成功', async ({ page }) => {
    await stubBase(page);
    await page.route('**/api/runtimes/*/auth/begin', (route) =>
      route.fulfill({
        json: {
          challengeRef: 'chal-device',
          method: 'oauth-device',
          kind: 'device-code',
          userCode: 'WDJB-MJHT',
          verificationUrl: 'https://openai.com/device',
          expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          instructions: '',
        },
      }),
    );
    await page.route('**/api/runtimes/*/auth/status*', (route) =>
      route.fulfill({ json: { status: 'success', maskedIdentifier: 'a***@gmail.com' } }),
    );

    await page.goto('/settings/credentials');
    // codex 帐号授权行已生效 → [重新授权]
    await page.getByRole('button', { name: '重新授权' }).first().click();
    // 设备码 + 倒计时展示
    await expect(page.getByLabel('设备码')).toHaveText('WDJB-MJHT');
    await expect(page.getByLabel('倒计时')).toBeVisible();
    // 轮询到成功 → 凭证已更新 toast（面板收起）
    await expect(page.getByText('凭证已更新')).toBeVisible();
  });

  test('② setup-token：Claude Code [帐号授权] → 粘贴授权码 → 提交成功', async ({ page }) => {
    await stubBase(page);
    await page.route('**/api/runtimes/*/auth/begin', (route) =>
      route.fulfill({
        json: {
          challengeRef: 'chal-setup',
          method: 'setup-token',
          kind: 'paste-prompt',
          verificationUrl: 'https://claude.ai/setup-token',
          instructions: '在浏览器完成授权后，复制授权码粘贴回来。',
        },
      }),
    );
    let completed = false;
    await page.route('**/api/runtimes/*/auth/complete', (route) => {
      completed = true;
      return route.fulfill({
        json: { maskedIdentifier: 'a***@gmail.com', activeAuthMethod: 'account' },
      });
    });

    await page.goto('/settings/credentials');
    // Claude Code 帐号授权（未配置）
    await page.getByRole('button', { name: '帐号授权' }).first().click();
    await expect(page.getByText('打开授权链接 ↗')).toBeVisible();
    await page.getByPlaceholder('粘贴从浏览器复制的授权码').fill('auth-code-xyz');
    await page.getByRole('button', { name: '提交' }).click();
    await expect(page.getByText('凭证已更新')).toBeVisible();
    expect(completed).toBe(true);
  });

  test('③ api-key：[添加 API Key] → 密码遮罩输入 → 保存；全文无完整 key', async ({ page }) => {
    await stubBase(page);
    await page.route('**/api/runtimes/*/credentials/secret', (route) =>
      route.fulfill({ json: { maskedIdentifier: 'sk-...uvwx', activeAuthMethod: 'api-key' } }),
    );

    await page.goto('/settings/credentials');
    await page.getByRole('button', { name: '添加 API Key' }).first().click();
    const input = page.getByPlaceholder('sk-…');
    await expect(input).toHaveAttribute('type', 'password');
    await input.fill(FULL_KEY);
    await page.getByRole('button', { name: '保存并继续' }).click();
    await expect(page.getByText('凭证已更新')).toBeVisible();
    // 掩码红线：页面任何位置都无完整 key
    expect(await page.content()).not.toContain(FULL_KEY);
  });

  test('④ 吊销确认文案含「重启 / 无法追回」（P0-4）', async ({ page }) => {
    await stubBase(page);
    let revoked = false;
    await page.route('**/api/runtimes/*/credentials/rc-codex-account', (route) => {
      revoked = true;
      return route.fulfill({ status: 204, body: '' });
    });

    await page.goto('/settings/credentials');
    await page.getByRole('button', { name: '吊销' }).first().click();
    // P0-4 延迟语义必现
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('重启');
    await expect(dialog).toContainText('无法追回');
    await page.getByRole('button', { name: '确认吊销' }).click();
    await expect(page.getByText('凭证已吊销')).toBeVisible();
    expect(revoked).toBe(true);
  });
});
