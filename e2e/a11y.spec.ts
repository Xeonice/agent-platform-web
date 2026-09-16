import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type {
  SystemProvidersDto,
  SystemResourcesDto,
  SystemSettingsDto,
} from '../src/types/system';
import type { AuditListDto } from '../src/types/audit';
import type { ProjectDto } from '../src/types/project';
import type { SandboxDto } from '../src/types/sandbox';
import { stubInitialized } from './initGate';
import { stubHealth } from './fixtures';

const GB = 1024 ** 3;
/*
 * ⚠️ 系统状态页的替身必须给**契约形状**，⛔ 不能拿 `{}` 糊弄。
 * 第一版把整个 system 前缀一把糊成 {}，结果整页崩掉、Next 换上错误页 ——
 * axe 于是报出 `html-has-lang` / `document-title` 这种**根布局明明有**的项。
 * 差点被当成真缺陷去改根布局。⇒ 页面崩了的 axe 结果不是这一页的 a11y 结论。
 */
const RESOURCES: SystemResourcesDto = {
  cpu: { cores: 8, loadAvg1m: 0.8, usedPercent: 10, level: 'ok' },
  ram: { totalBytes: 16 * GB, usedBytes: 3.2 * GB, usedPercent: 20, level: 'ok' },
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
const SYSTEM_PROVIDERS: SystemProvidersDto = {
  providers: [],
  runtimes: [],
  imageSpecs: [],
  healthWindowMs: 3_600_000,
};

/*
 * axe 复验（design-notes.md §4 Phase 5 第 2 条：「落地后用**真实渲染**跑一遍 axe 复验」）。
 *
 * ── ⚠️ 为什么不是靠 `@storybook/addon-a11y` ──────────────────────────────────
 * 那个 addon 装了、`main.ts` 挂了、`vitest.storybook.config.ts` 的文件头也写着
 * 「Storybook 交互 / **a11y 测试**」—— **但它一条都不判**（2026-09-15 实测）。
 *
 * 根因在 addon 自己的 `afterEach` 里：
 *   `getIsVitestStandaloneRun() && hasViolations && getMode()==='failed'`
 *   `getIsVitestStandaloneRun = () => import.meta.env.VITEST_STORYBOOK === 'false'`
 * 而 `VITEST_STORYBOOK` 是 **storybook 的 vitest 插件自己 define 进去的**，走插件跑就是
 * "非 standalone" ⇒ 违规只进报告、不抛断言。从外面设环境变量也盖不掉。
 *
 * 实证过程（⛔ 不是读配置猜的）：造一个「有尺寸但无可访问名的按钮 + 无 alt 的图片」
 * 的 story（axe 的 button-name / image-alt 必报），跑 storybook 测试 ⇒ 照样 `1 passed`。
 * ⚠️ 第一版探针用的是**零尺寸空按钮**，那个 axe 本来就会跳过不可见元素 —— 换成有尺寸的
 * 才算数。这一步不做，会把"探针没触发"错当成"没有违规"。
 *
 * ⇒ 真正的门禁放在这里：**真实渲染的整页**，比逐个 story 更接近用户看到的东西
 *   （组合起来才会出现的重复 id、地标缺失、对比度叠加，单个 story 里看不见）。
 *
 * ⚠️ 只收 **violations**，不收 `incomplete`：后者是 axe 自己都拿不准、要人工判的项
 * （典型是被半透明层盖住的文字算不出对比度）。把它也当失败会逼着后人为了消红去改
 * 不该改的东西，或者干脆把整条规则关掉 —— 那比不测更糟。
 */

const require_ = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require_.resolve('axe-core/axe.min.js'), 'utf8');

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[] }[];
}

/** 把 axe 注入真实页面并跑一遍，返回 violations。 */
async function runAxe(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    // @ts-expect-error axe 由 addScriptTag 注入到 window 上，没有类型
    const result = await window.axe.run(document, {
      // 与 addon 默认一致：`region` 规则要求所有内容都在地标里，对局部渲染的页面噪音太大。
      rules: { region: { enabled: false } },
    });
    return (result.violations as AxeViolation[]).map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({ target: n.target })),
    }));
  });
}

/** 把违规整理成一眼能看懂的字符串（断言失败时直接显示在报告里）。 */
function describe(violations: AxeViolation[]): string {
  return violations
    .map(
      (v) =>
        `  [${v.impact ?? '?'}] ${v.id}: ${v.help}\n    → ${v.nodes.map((n) => n.target.join(' ')).join('\n    → ')}`,
    )
    .join('\n');
}

test.describe('axe 复验（真实渲染）', () => {
  test.beforeEach(async ({ page }) => {
    await stubHealth(page);
    await stubInitialized(page);
    await page.route('**/api/projects', (r) =>
      r.fulfill({ status: 200, json: [] satisfies ProjectDto[] }),
    );
    await page.route('**/api/sandboxes*', (r) =>
      r.fulfill({ status: 200, json: [] satisfies SandboxDto[] }),
    );
    // contract-exempt: 本页只测 a11y，这些端点只需返回「空列表」让页面进到空态；形状由各自的 spec 锚定。
    await page.route('**/api/runtimes*', (r) => r.fulfill({ status: 200, json: [] }));
    // contract-exempt: 本页只测 a11y，这些端点只需返回「空列表」让页面进到空态；形状由各自的 spec 锚定。
    await page.route('**/api/credentials*', (r) => r.fulfill({ status: 200, json: [] }));
    // contract-exempt: 本页只测 a11y，这些端点只需返回「空列表」让页面进到空态；形状由各自的 spec 锚定。
    await page.route('**/api/git-credentials*', (r) => r.fulfill({ status: 200, json: [] }));
    // contract-exempt: 本页只测 a11y，这些端点只需返回「空列表」让页面进到空态；形状由各自的 spec 锚定。
    await page.route('**/api/images*', (r) => r.fulfill({ status: 200, json: [] }));
    // contract-exempt: 本页只测 a11y，这些端点只需返回「空列表」让页面进到空态；形状由各自的 spec 锚定。
    await page.route('**/api/retained-volumes*', (r) => r.fulfill({ status: 200, json: [] }));
    // contract-exempt: 本页只测 a11y，这些端点只需返回「空列表」让页面进到空态；形状由各自的 spec 锚定。
    await page.route('**/api/automations*', (r) => r.fulfill({ status: 200, json: [] }));
    await page.route('**/api/system/resources', (r) =>
      r.fulfill({ json: RESOURCES satisfies SystemResourcesDto }),
    );
    await page.route('**/api/system/providers', (r) =>
      r.fulfill({ json: SYSTEM_PROVIDERS satisfies SystemProvidersDto }),
    );
    /*
     * ⚠️ 这两个的形状必须来自**契约类型**，⛔ 不能凭印象写。
     * 第一版把审计列表写成 `{events: [], hasMore: false}` —— 而契约里那个字段叫
     * `items`。形状不对 ⇒ 页面崩 ⇒ axe 报出 `html-has-lang` / `document-title` 这种
     * 根布局明明有的项，差点被当成真缺陷去改根布局。
     */
    await page.route('**/api/system/audit**', (r) =>
      r.fulfill({ json: { items: [], hasMore: false } satisfies AuditListDto }),
    );
    await page.route('**/api/system/settings', (r) => r.fulfill({ json: {} as SystemSettingsDto }));
  });

  for (const [path, label] of [
    ['/', '工作台'],
    ['/settings/credentials', '凭证管理'],
    ['/settings/images', '镜像管理'],
    ['/settings/system', '系统状态'],
  ] as const) {
    test(`${label}（${path}）没有 axe violations`, async ({ page }) => {
      await page.goto(path);
      // 等首屏稳定：这几页都靠 query 填内容，太早跑 axe 量到的是骨架屏。
      await page.waitForTimeout(1500);
      const violations = await runAxe(page);
      expect(violations, `\n${describe(violations)}\n`).toEqual([]);
    });
  }
});
