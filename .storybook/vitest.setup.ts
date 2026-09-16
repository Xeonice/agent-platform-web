// Storybook Vitest addon setup（12 §2.3）：把 preview 注解注入到浏览器测试运行时。
import { beforeAll } from 'vitest';
import { setProjectAnnotations } from '@storybook/nextjs-vite';
/*
 * ⚠️ 注入 a11y addon 的注解，让违规**至少进得了报告**（Storybook UI / reporter 能看到）。
 *
 * ⛔⛔ **但这不是一道门禁 —— 它判不了失败。** addon 自己的 `afterEach` 里写着：
 *     `getIsVitestStandaloneRun() && hasViolations && getMode()==='failed'`
 *     `getIsVitestStandaloneRun = () => import.meta.env.VITEST_STORYBOOK === 'false'`
 *   而 `VITEST_STORYBOOK` 是 **storybook 的 vitest 插件自己 define 进去的** —— 走插件跑
 *   就永远是"非 standalone"，违规只进报告、不抛断言。从外面设环境变量也盖不掉。
 *
 * ⚠️ 2026-09-15 实证（⛔ 不是读配置猜的）：造一个「有尺寸但无可访问名的按钮 + 无 alt 的
 *   图片」的 story（axe 必报两条），配上 `a11y: { test: 'error' }` 跑 ⇒ 照样 `1 passed`。
 *   第一版探针用的是**零尺寸空按钮**，那个 axe 本来就跳过不可见元素 —— 换成有尺寸的才算数。
 *
 * ⇒ **真正的 a11y 门禁在 `e2e/a11y.spec.ts`**（真实渲染整页 + 直接跑 axe-core）。
 *   ⛔ 不要因为这里看起来"接上了"就以为 storybook 这侧在守门。
 */
import * as a11yAddonAnnotations from '@storybook/addon-a11y/preview';
import * as previewAnnotations from './preview';

const project = setProjectAnnotations([a11yAddonAnnotations, previewAnnotations]);

beforeAll(project.beforeAll);
