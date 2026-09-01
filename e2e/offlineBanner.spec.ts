import { test, expect, type Page } from '@playwright/test';
import type { InitStatusDto } from '../src/types/system';
import { INITIALIZED_STATUS, stubInitialized } from './initGate';

// F21-8 §4「离线模式的跨页影响」+ §7.4 补充场景 3 + §9.1 #16/#17。
// REST 用 `page.route`（E2E 层不启 MSW，12 §4.1）。
//
// ⭐ **本文件里最要紧的是 §9.1 #17 点名仍缺的那两条否定断言**：
//    「不置灰清单仍可用」与「只置灰不隐藏」。少了它们，把整块侧栏 disable、
//    或干脆把入口藏起来，都能让上面那条正向断言照样绿。

/** 模型 API 全挂、镜像仓库通着 —— 离线判定只看模型 API 那一半。 */
const OFFLINE_STATUS: InitStatusDto = {
  ...INITIALIZED_STATUS,
  lastConnectivityCheck: [
    { target: 'api.openai.com', ok: false, hint: '连接超时', modelApi: true },
    { target: 'api.anthropic.com', ok: false, hint: '连接超时', modelApi: true },
    { target: 'ghcr.io', ok: true, latencyMs: 66, modelApi: false },
  ],
  lastConnectivityCheckAt: '2026-08-29T16:11:34.000Z',
};

async function stubWorkbench(page: Page, status: InitStatusDto): Promise<void> {
  await page.route('**/api/system/init-status', (route) => route.fulfill({ json: status }));
  await page.route('**/api/health', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/sandboxes*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/projects', (route) =>
    route.fulfill({
      json: [
        {
          id: 'proj-offline',
          name: '离线项目',
          sourceType: 'empty',
          cloneStatus: 'ready',
          cloneErrorCode: null,
          taskCount: 0,
          createdAt: new Date().toISOString(),
        },
      ],
    }),
  );
}

test.describe('F21-8 §4 离线模式：全局横幅 + 发起入口置灰', () => {
  test('⭐ 🔴 横幅 + [+ 新任务] 置灰；⛔ 项目管理不受影响、入口不隐藏', async ({ page }) => {
    await stubWorkbench(page, OFFLINE_STATUS);
    await page.goto('/');

    const banner = page.getByTestId('banner-offline');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-severity', 'blocking');
    await expect(banner).toContainText('Agent 不可用');
    // 必须说清"哪一半还好着"，否则用户会以为整台平台废了。
    await expect(banner).toContainText('照常可用');

    await page.getByRole('button', { name: /离线项目/ }).click();
    const newTask = page.getByTestId('new-task-entry');
    // 项目已就绪，唯一的置灰理由是离线。
    await expect(newTask).toBeDisabled();
    await expect(newTask).toHaveAttribute('title', '离线模式：需连接网络才能发起任务');
    // ⭐ 否定断言 ①：**只置灰不隐藏**（P21-8 §7）——配好网络后不该需要重装才看得到入口。
    await expect(newTask).toBeVisible();
    // ⭐ 否定断言 ②：**不置灰清单仍可用**——项目管理不依赖出网。
    await expect(page.getByRole('button', { name: /新建项目/ })).toBeEnabled();

    /*
     * ⭐ 否定断言 ③：**横幅出现之后整页仍然不滚**。
     *
     * 工作台壳与设置页壳此前各自 `h-screen`；横幅是它们的**前置兄弟**，于是
     * "100vh + 横幅高度"会把 body 顶出一条整页滚动条，而 xterm 的 fit 会按那个失控高度
     * 算行数（`WorkbenchShell.view` 里已经为同一件事写过一次注释）。改成"根布局给
     * `h-screen` 的 flex 列、壳用 `h-full`"之后这条才成立 —— 而它在截图上极不显眼：
     * 页面看起来只是"稍微能滚一点"。
     * 变异：把 `WorkbenchShell.view` 的 `h-full` 改回 `h-screen` ⇒ 本行红。
     */
    const overflows = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return el.scrollHeight - el.clientHeight;
    });
    expect(overflows).toBeLessThanOrEqual(1);
  });

  test('⭐ [重新检测] 去系统状态页；⛔ 不在工作台就地跑一轮看不见的诊断', async ({ page }) => {
    await stubWorkbench(page, OFFLINE_STATUS);
    let diagnoseFromWorkbench = 0;
    await page.route('**/api/system/diagnose', async (route) => {
      diagnoseFromWorkbench += 1;
      await route.fulfill({
        status: 500,
        json: { code: 'INTERNAL', message: 'x', retryable: true },
      });
    });
    await page.goto('/');
    await expect(page.getByTestId('banner-offline')).toBeVisible();

    await page.getByTestId('banner-action-offline').click();
    await expect(page).toHaveURL(/\/settings\/system$/);
    // 诊断只有一个所有者：它在这一页跑，界面上看得见（⛔ 不是在工作台后台悄悄跑）。
    //
    // ⚠️ 必须 `expect.poll`：URL 变了只说明路由到了，那一发诊断请求是系统状态页**挂载之后**
    // 才发出的。裸 `expect(...)` 在这里是一场赛跑——实测在整套并行跑时会零星红一次
    //（单跑这条 spec 从不红），而它钉的行为其实完全正常。
    await expect.poll(() => diagnoseFromWorkbench).toBeGreaterThan(0);
  });

  test('关闭是显式动作，关掉之后横幅不再出现（🔴 不自动收起也不自己弹回来）', async ({ page }) => {
    await stubWorkbench(page, OFFLINE_STATUS);
    await page.goto('/');
    await page.getByTestId('banner-dismiss-offline').click();
    await expect(page.getByTestId('banner-offline')).toHaveCount(0);
  });

  /**
   * ⭐ **横幅与阻塞式向导互斥这件事，只有走真 `app/layout.tsx` 才验得到。**
   *
   * 单测里那条（`GlobalBannerContainer.test.tsx`）把横幅**手动**放进 `AppBootGate` 的
   * children 里，于是它证明的是"放对了位置就互斥"——而真正会出错的是**根布局里放哪**。
   * 把 `<GlobalBannerContainer />` 挪到 `</AppBootGate>` 外面，那条单测照样绿（实测），
   * 只有本例会红。
   *
   * 为什么必须互斥：向导是阻塞式的（F21-8 §2「没有 [取消]、没有 Esc 逃逸」），
   * 在它上面挂一条带 [重新检测] 的横幅，那个按钮会把用户从一个不许离开的流程里带走。
   */
  test('⭐ 未初始化 ⇒ 只有向导，横幅**不出现**（走真根布局）', async ({ page }) => {
    await stubWorkbench(page, { ...OFFLINE_STATUS, initialized: false });
    await page.route('**/api/system/settings', (route) =>
      route.fulfill({
        json: {
          initialized: false,
          accessPasscodeEnabled: false,
          version: { platform: 'e2e', node: 'v22' },
        },
      }),
    );
    await page.goto('/');

    await expect(page.getByTestId('init-wizard')).toBeVisible();
    await expect(page.getByTestId('banner-stack')).toHaveCount(0);
    await expect(page.getByTestId('banner-offline')).toHaveCount(0);
    // 离线这件事在初始化阶段由向导自己的 `OfflineNotice` 说（那才是该说它的地方）。
    await expect(page.getByTestId('offline-notice')).toBeVisible();
  });

  test('⭐ 出网正常 ⇒ 没有横幅，[+ 新任务] 选中就绪项目后可点', async ({ page }) => {
    await stubInitialized(page);
    await stubWorkbench(page, INITIALIZED_STATUS);
    await page.goto('/');
    await expect(page.getByTestId('banner-stack')).toHaveCount(0);
    await page.getByRole('button', { name: /离线项目/ }).click();
    await expect(page.getByTestId('new-task-entry')).toBeEnabled();
  });
});
