import { test, expect, type Page } from '@playwright/test';
import { stubInitialized } from './initGate';
import { stubHealth, type ErrorEnvelope } from './fixtures';
import type { ProjectDto } from '../src/types/project';
import type { SandboxDto } from '../src/types/sandbox';
import type { RetainedVolumeDto } from '../src/types/retainedVolume';
import type { AutomationDto } from '../src/types/automation';

// F21-6 §10.7 e2e 行：组头「⋯」→ 菜单 → [删除] → 确认 → 树上该项目消失。
//
// ⚠️ 这是**八页里第二个缺 e2e 的位置**（另一个是 F21-4），别再欠 —— 而且这一条尤其欠不得：
// 删除项目是**不可逆**操作，在这一轮之前它在界面上根本够不着（唯一途径是自己拼 URL 打 API，
// 没有二次确认、没有级联后果、没有运行中任务警示，§10.1）。
//
// 本文件另外钉两条最容易做错的（§10.6）：
//   · 删的正是当前选中项目 ⇒ 选中态清空、主区回引导态（**不是白屏**，也不是指着一个 404 的 id）；
//   · 后端 409 ⇒ 弹层留在原地把原因说出来，⛔ 不静默关闭（否则用户以为删掉了，而树上还在）。

const PROJECT_A = {
  id: 'proj-a',
  name: 'E2E 菜单项目A',
  sourceType: 'empty',
  cloneStatus: 'ready',
  cloneErrorCode: null,
  taskCount: 2,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
} satisfies ProjectDto;

const PROJECT_B = {
  ...PROJECT_A,
  id: 'proj-b',
  name: 'E2E 菜单项目B',
  taskCount: 0,
} satisfies ProjectDto;

/**
 * 两条运行中 + 一条已停：警示句里那个数只有读真数据才会是 2。
 *
 * ⭐ `satisfies SandboxDto[]` 当场补出了**五个契约必填字段**（`runtime` / `provider` /
 * `headless` / `timeoutMinutes` / `idleTimeoutSec`）——这三条 fixture 此前只有前端恰好会读
 * 的那六个键。少的那五个今天没人读，所以它一直绿着；而"替身比契约窄"正是 29 §1.2
 * 第三次事故（e2e fixture 缺 3 个必填字段）的同一个形状。
 */
const SANDBOXES = [
  {
    id: 'sbx-1',
    projectId: 'proj-a',
    runtime: 'codex',
    availableRuntimes: ['codex'],
    provider: 'aio',
    name: '任务一',
    status: 'running',
    headless: false,
    timeoutMinutes: 120,
    idleTimeoutSec: 1800,
    waitingInput: false,
    version: 1,
  },
  {
    id: 'sbx-2',
    projectId: 'proj-a',
    runtime: 'codex',
    availableRuntimes: ['codex'],
    provider: 'aio',
    name: '任务二',
    // ⚠️ `idle` 是契约里真实存在的状态（`SandboxResponseDto.status` 十二态之一），
    //    不是随手写的——`waitingInput:true` 与它一起构成"等用户输入"那一档。
    status: 'idle',
    headless: false,
    timeoutMinutes: 120,
    idleTimeoutSec: 1800,
    waitingInput: true,
    version: 1,
  },
  {
    id: 'sbx-3',
    projectId: 'proj-a',
    runtime: 'codex',
    availableRuntimes: ['codex'],
    provider: 'aio',
    name: '任务三',
    status: 'stopped',
    headless: false,
    timeoutMinutes: 120,
    idleTimeoutSec: 1800,
    waitingInput: false,
    version: 1,
  },
] satisfies SandboxDto[];

test.beforeEach(async ({ page }) => {
  await stubInitialized(page);
});

/**
 * 项目列表由一个可变数组驱动：删除后要能真的从列表里消失（这正是本文件要看的）。
 *
 * ⭐ 此前这里是一个 `{ id; name; [key: string]: unknown }` 的**自造**接口 —— 索引签名
 * 让任何形状都能塞进来，等于把锁拆了。改成契约类型本身（29 §3.2：⛔ 不另造一套）。
 */
async function stubWorkbench(page: Page, state: { projects: ProjectDto[] }): Promise<void> {
  await stubHealth(page);
  await page.route('**/api/projects', (route) =>
    route.fulfill({ status: 200, json: state.projects satisfies ProjectDto[] }),
  );
  // ⚠️ 沙箱列表**跟着项目走**：后端删项目是级联的，被删项目的 Task 不会再出现在列表里。
  // 替身若一直原样返回，`selectProjectTaskTree` 会把它们收进「未分组」组——那是**替身**
  // 造出来的孤儿，不是产品行为。这样写顺带把 `useDeleteProject` 那条
  // 「删完也要 invalidate 沙箱列表」钉住了：不失效，孤儿组就会真的冒出来。
  /*
   * ⚠️ **详情面板 2026-09-14 起会多拉两个请求**（已保留成果数 / 自动化规则数两行摘要）。
   * 不 stub 的话它们会真发出去然后挂起 —— 弹层卡在加载态，而报错出现在**下一步**
   * （"找不到 project-group-menu"），看着像菜单坏了。这次排错就沿着菜单查了好几轮。
   */
  await page.route('**/api/retained-volumes*', (route) =>
    route.fulfill({ status: 200, json: [] satisfies RetainedVolumeDto[] }),
  );
  await page.route('**/api/automations*', (route) =>
    route.fulfill({ status: 200, json: [] satisfies AutomationDto[] }),
  );
  await page.route('**/api/sandboxes*', (route) =>
    route.fulfill({
      status: 200,
      json: SANDBOXES.filter((s) =>
        state.projects.some((p) => p.id === s.projectId),
      ) satisfies SandboxDto[],
    }),
  );
}

async function openGroupMenu(page: Page, projectName: string): Promise<void> {
  const header = page.getByTestId('project-group-header').filter({ hasText: projectName });
  /*
   * ⚠️ **先等这一行组头自己到位，再去点它里面的 ⋯。**
   * `filter({hasText})` 在列表还没渲染出来时匹配到 **0 个**，此时
   * `header.getByTestId(...).click()` 只能靠 Playwright 的自动等待去赌 —— 首次打开
   * 通常赌赢，但**关掉弹层那一瞬 DOM 会短暂重排**，第二次开菜单就会落空，
   * 报错是「找不到 project-group-menu」，看着像菜单坏了（这次排错先怀疑了 Radix 的
   * 退场动画和 overlay 残留，都不是）。
   */
  await expect(header).toHaveCount(1);
  await header.getByTestId('project-group-menu-trigger').click();
  await expect(page.getByTestId('project-group-menu')).toBeVisible();
}

test.describe('F21-6 项目菜单整块（含删除入口）', () => {
  test('⭐ 组头「⋯」→ 菜单 → [删除] → 确认 → 树上该项目消失', async ({ page }) => {
    const state = { projects: [{ ...PROJECT_A }, { ...PROJECT_B }] };
    await stubWorkbench(page, state);

    let deletedId: string | null = null;
    await page.route('**/api/projects/*', async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.fallback();
        return;
      }
      deletedId = new URL(route.request().url()).pathname.split('/').pop() ?? null;
      state.projects = state.projects.filter((p) => p.id !== deletedId);
      await route.fulfill({ status: 204, body: '' });
    });

    await page.goto('/');
    await expect(page.getByTestId('project-group-header')).toHaveCount(2);

    /*
     * ⚠️ **2026-09-14 菜单拍平，这条路少了一跳也换了入口**：此前是
     * ⋯ → [项目菜单…] → 面板里的 [删除项目…]（那个二级面板与面板内的删除按钮都已删除，
     * 后者与菜单里的删除是同一个不可逆动作的**两个入口**）。现在从 ⋯ 直接进删除确认。
     *
     * ⛔ **本用例不再顺路去看一眼详情面板**：我一度在这里插了「先开详情、断言里面没有
     * 删除入口、再关掉、再开菜单」一段 —— 那一开一关会让这条**删除主链路**莫名其妙地
     * 失败（另外两条同样走 ⋯ → [删除项目…] 的用例都稳过，只有插了这段的这条红），
     * 追了七八轮探针都没能在最小复现里重现，说明它引入的是时序上的不确定性。
     * 而「详情面板里没有危险动作」本来就由 `ProjectDetailPanel` 的
     * `NoDangerousActionsInDetail` story 钉着（那条还更强：整个面板 role=button 计数为 0）。
     * ⇒ e2e 只负责跑通真实链路，⛔ 不在破坏性操作的主链路上搭顺风车验别的事。
     */
    await openGroupMenu(page, 'E2E 菜单项目A');
    await page.getByTestId('group-menu-delete').click();
    const panel = page.getByTestId('modal-project-menu');
    await expect(panel).toBeVisible();
    // ⛔ 否定性：这个弹层里**不出现「来源」行**（§6），也不出现凭证/镜像入口（§9.1 #24）。
    await expect(panel).not.toContainText('来源');
    await expect(panel).not.toContainText('凭证');
    await expect(panel).not.toContainText('镜像');

    // 级联后果 + **真数据**的运行中任务警示（§10.6 第 3 条）。
    //
    // ⚠️ **钉「必须说到的三件事」，⛔ 不钉整句**：破坏性操作的后果要回答三个用户真的会问
    //    的问题 —— 删什么 / 留什么 / 能不能反悔。措辞会再变，这三问不会变。
    // ⚠️ 其中「远端仓库不受影响」是最要紧的一条：那是开发者按下去之前最想确认的事，
    //    旧文案一个字都没说。
    // ⛔ 这里曾经逐字钉着旧文案「将删除该项目下 2 个 Task 及其数据卷…」—— 文案巡检把
    //    代码术语 `Task` 改成「任务」、把括号里那句存疑的「保留的成果卷除外」删掉之后，
    //    这条就红了。整句断言在文案上是**必然过期**的。
    const cascade = page.getByTestId('delete-cascade-copy');
    await expect(cascade).toContainText('2 个任务');
    await expect(cascade).toContainText('远端 Git 仓库不受影响');
    await expect(cascade).toContainText('拿不回来');
    // ⚠️ 同样钉意思不钉整句：**数量**（真数据，不是写死的 2）+ **会被强制停下**。
    //    旧断言逐字钉「含 2 个运行中任务将被强制停止」，文案改成「其中 2 个任务正在跑，
    //    会被强制停下。」之后必然红。
    const runningWarn = page.getByTestId('delete-running-warning');
    await expect(runningWarn).toContainText('2 个');
    await expect(runningWarn).toContainText('强制停');

    await page.getByTestId('delete-confirm').click();

    await expect(page.getByTestId('modal-project-menu')).toHaveCount(0);
    await expect(page.getByTestId('project-group-header')).toHaveCount(1);
    await expect(page.getByTestId('project-group-header')).toContainText('E2E 菜单项目B');
    // ⭐ 其 Task 也不残留（§7.3「删除级联」：不许留下一个「未分组」的孤儿组）。
    await expect(page.getByText('未分组')).toHaveCount(0);
    expect(deletedId).toBe('proj-a');
  });

  test('⭐ 删的正是当前选中项目 ⇒ 选中态清空、主区回引导态（不是白屏）', async ({ page }) => {
    const state = { projects: [{ ...PROJECT_A }, { ...PROJECT_B }] };
    await stubWorkbench(page, state);
    await page.route('**/api/projects/*', async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.fallback();
        return;
      }
      const id = new URL(route.request().url()).pathname.split('/').pop();
      state.projects = state.projects.filter((p) => p.id !== id);
      await route.fulfill({ status: 204, body: '' });
    });

    await page.goto('/');
    await page.getByRole('button', { name: /E2E 菜单项目A/ }).click();
    await expect(page.getByTestId('current-project-indicator')).toContainText('E2E 菜单项目A');

    await openGroupMenu(page, 'E2E 菜单项目A');
    await page.getByTestId('group-menu-delete').click();
    await page.getByTestId('delete-confirm').click();

    // ⛔ 不许留一个指向已删项目的选中态（它是 persist 的，刷新之后还在指着 404 的 id）。
    await expect(page.getByTestId('current-project-indicator')).toContainText('未选择项目');
    await expect(page.getByText('选择左侧项目，或新建一个项目开始。')).toBeVisible();
  });

  test('⭐ 后端 409 ⇒ 弹层留在原地并显示原因，⛔ 不静默关闭', async ({ page }) => {
    const state = { projects: [{ ...PROJECT_A }] };
    await stubWorkbench(page, state);
    await page.route('**/api/projects/*', async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.fallback();
        return;
      }
      // ⚠️ 码必须是**契约里真有的那个**。这里曾经 stub `'CONFLICT'` —— 它在 10 §6.8
      //    的错误码表里**一次都没出现过**，后端这条路回的是 `INVALID_STATE`。
      //    旧实现不看码、把 `message` 原样上屏，所以这个虚构一直没被发现；
      //    文案巡检改成按码查表之后才露出来。⛔ 别再用不存在的码 stub。
      await route.fulfill({
        status: 409,
        json: {
          code: 'INVALID_STATE',
          message: '该项目仍有运行中的任务，请先停止后再删除。',
          retryable: false,
        } satisfies ErrorEnvelope,
      });
    });

    await page.goto('/');
    await openGroupMenu(page, 'E2E 菜单项目A');
    await page.getByTestId('group-menu-delete').click();
    await page.getByTestId('delete-confirm').click();

    // ⚠️ 钉的是「**按码给出的那句客户端文案**要上屏」，⛔ 不是服务端 message。
    //    这个仓库刻意的规则：服务端 message 永远不上屏（它可能是英文技术腔 ——
    //    `useProjects.test.tsx` 里那条用例 stub 的正是 `'project has running tasks'`），
    //    ⇒ 码 → 本地文案表。换成通用兜底「删除失败，请稍后重试。」才是真出问题。
    await expect(page.getByTestId('delete-error')).toContainText('这个项目现在删不掉');
    await expect(page.getByTestId('delete-error')).toContainText('先停掉');
    await expect(page.getByTestId('modal-project-menu')).toBeVisible();
    // 树里那一项一动没动（没有乐观删除）。
    await expect(page.getByTestId('project-group-header')).toHaveCount(1);
  });
});
