import type { Page } from '@playwright/test';
import type { InitStatusDto } from '../src/types/system';

// F21-8 §2：`AppBootGate` 现在挂在**根布局**上 —— 于是**每一个** e2e 用例（不管它 goto 的是
// `/` 还是 `/settings/*`）都会先打一次 `GET /api/system/init-status`。
//
// ⚠️ 不 stub 它的话，这些用例就依赖"CI 里恰好没有后端、于是这条请求失败得很快、
//    `AppBootGate` 走 fail-open 放行"——那是**用环境兜住的测试**（与 `systemAudit.spec.ts`
//    stub 掉资源/provider 两条是同一条理由）。本机开着后端跑同一条用例时，
//    真实的 `initialized:false` 会让向导挡在前面，用例莫名其妙地红。
//
// ⇒ 每个 spec 在 `page.goto` 之前调一次 `stubInitialized(page)`。

export const INITIALIZED_STATUS: InitStatusDto = {
  initialized: true,
  initializedAt: '2026-07-01T00:00:00.000Z',
  lastConnectivityCheck: [
    { target: 'api.openai.com', ok: true, latencyMs: 182, modelApi: true },
    { target: 'api.anthropic.com', ok: true, latencyMs: 291, modelApi: true },
    { target: 'ghcr.io', ok: true, latencyMs: 66, modelApi: false },
  ],
  lastConnectivityCheckAt: '2026-07-01T00:00:00.000Z',
};

/** 「这台机器已经初始化过了」——`AppBootGate` 因此直接渲染子树。 */
export async function stubInitialized(page: Page): Promise<void> {
  await page.route('**/api/system/init-status', async (route) => {
    await route.fulfill({ json: INITIALIZED_STATUS });
  });
}
