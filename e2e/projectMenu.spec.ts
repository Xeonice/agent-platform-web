import { test, expect, type Page } from '@playwright/test';
import { stubInitialized } from './initGate';

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
};

const PROJECT_B = { ...PROJECT_A, id: 'proj-b', name: 'E2E 菜单项目B', taskCount: 0 };

/** 两条运行中 + 一条已停：警示句里那个数只有读真数据才会是 2。 */
const SANDBOXES = [
  {
    id: 'sbx-1',
    projectId: 'proj-a',
    name: '任务一',
    status: 'running',
    waitingInput: false,
    version: 1,
  },
  {
    id: 'sbx-2',
    projectId: 'proj-a',
    name: '任务二',
    status: 'idle',
    waitingInput: true,
    version: 1,
  },
  {
    id: 'sbx-3',
    projectId: 'proj-a',
    name: '任务三',
    status: 'stopped',
    waitingInput: false,
    version: 1,
  },
];

test.beforeEach(async ({ page }) => {
  await stubInitialized(page);
});

/** 项目列表由一个可变数组驱动：删除后要能真的从列表里消失（这正是本文件要看的）。 */
interface ProjectFixture {
  id: string;
  name: string;
  [key: string]: unknown;
}

async function stubWorkbench(page: Page, state: { projects: ProjectFixture[] }): Promise<void> {
  await page.route('**/api/health', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/projects', (route) =>
    route.fulfill({ status: 200, json: state.projects }),
  );
  // ⚠️ 沙箱列表**跟着项目走**：后端删项目是级联的，被删项目的 Task 不会再出现在列表里。
  // 替身若一直原样返回，`selectProjectTaskTree` 会把它们收进「未分组」组——那是**替身**
  // 造出来的孤儿，不是产品行为。这样写顺带把 `useDeleteProject` 那条
  // 「删完也要 invalidate 沙箱列表」钉住了：不失效，孤儿组就会真的冒出来。
  await page.route('**/api/sandboxes*', (route) =>
    route.fulfill({
      status: 200,
      json: SANDBOXES.filter((s) => state.projects.some((p) => p.id === s.projectId)),
    }),
  );
}

async function openGroupMenu(page: Page, projectName: string): Promise<void> {
  const header = page.getByTestId('project-group-header').filter({ hasText: projectName });
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

    await openGroupMenu(page, 'E2E 菜单项目A');
    await page.getByTestId('group-menu-open-panel').click();
    const panel = page.getByTestId('modal-project-menu');
    await expect(panel).toBeVisible();
    // ⛔ 否定性：项目菜单里**不出现「来源」行**（§6），也不出现凭证/镜像入口（§9.1 #24）。
    await expect(panel).not.toContainText('来源');
    await expect(panel).not.toContainText('凭证');
    await expect(panel).not.toContainText('镜像');

    await panel.getByTestId('project-delete-entry').click();

    // 级联后果 + **真数据**的运行中任务警示（§10.6 第 3 条）。
    await expect(page.getByTestId('delete-cascade-copy')).toContainText(
      '将删除该项目下 2 个 Task 及其数据卷（保留的成果卷除外），不可逆。',
    );
    await expect(page.getByTestId('delete-running-warning')).toContainText(
      '含 2 个运行中任务将被强制停止',
    );

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
    await page.getByTestId('group-menu-open-panel').click();
    await page.getByTestId('project-delete-entry').click();
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
      await route.fulfill({
        status: 409,
        json: {
          code: 'CONFLICT',
          message: '该项目仍有运行中的任务，请先停止后再删除。',
          retryable: false,
        },
      });
    });

    await page.goto('/');
    await openGroupMenu(page, 'E2E 菜单项目A');
    await page.getByTestId('group-menu-open-panel').click();
    await page.getByTestId('project-delete-entry').click();
    await page.getByTestId('delete-confirm').click();

    await expect(page.getByTestId('delete-error')).toContainText('该项目仍有运行中的任务');
    await expect(page.getByTestId('modal-project-menu')).toBeVisible();
    // 树里那一项一动没动（没有乐观删除）。
    await expect(page.getByTestId('project-group-header')).toHaveCount(1);
  });
});
