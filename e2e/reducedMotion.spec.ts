import { test, expect } from '@playwright/test';
import type { ProjectDto } from '../src/types/project';
import type { SandboxDto } from '../src/types/sandbox';
import { stubInitialized } from './initGate';
import { stubHealth } from './fixtures';

/*
 * 「减少动态效果」的兜底（design-notes.md §4 Phase 5 第 1 条）。
 *
 * ⚠️ **为什么非要用 e2e 钉**：这是一条**纯 CSS**的媒体查询，写在 `globals.css` 里。
 * typecheck 看不见它、lint 看不见它、jsdom 里的 unit/storybook 也测不出 —— 那套环境
 * 既不解析 Tailwind 产物、也不实现 `prefers-reduced-motion`。换句话说，**删掉那段 CSS，
 * 除了这个文件以外没有任何一道门会红**。而它保护的是前庭功能障碍用户会不会被晃到眩晕。
 *
 * ⚠️ 断言写成「压到 1ms 以内」而不是「等于 0s」：实现刻意用 `0.01ms` 而非 `0` ——
 * 有些浏览器对 `0s` 不触发 `transitionend`/`animationend`，而 Radix 的退场就等这个事件，
 * 归零会让元素永远卡在退场中。理由写在 `globals.css` 那段注释里。
 */
test.describe('prefers-reduced-motion 兜底', () => {
  test.beforeEach(async ({ page }) => {
    await stubHealth(page);
    await stubInitialized(page);
    await page.route('**/api/projects', (r) =>
      r.fulfill({ status: 200, json: [] satisfies ProjectDto[] }),
    );
    await page.route('**/api/sandboxes*', (r) =>
      r.fulfill({ status: 200, json: [] satisfies SandboxDto[] }),
    );
  });

  /** 读一个探针元素上 Tailwind 动效类的实算时长（毫秒）。 */
  async function probeMs(page: import('@playwright/test').Page): Promise<{
    animation: number;
    transition: number;
  }> {
    return page.evaluate(() => {
      const el = document.createElement('div');
      // ⚠️ 这两个类必须是**真的在源码里用过的**，否则 Tailwind 不会生成它们，
      //    探针量到的是"类不存在"而不是"规则没生效"——那是个会骗人的绿。
      el.className = 'animate-spin transition-colors';
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const ms = (v: string): number => (v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000);
      const out = { animation: ms(cs.animationDuration), transition: ms(cs.transitionDuration) };
      el.remove();
      return out;
    });
  }

  test('⭐ 开了「减少动态效果」⇒ 动画与过渡都被压到 1ms 以内', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await stubHealth(page);
    await stubInitialized(page);
    await page.route('**/api/projects', (r) =>
      r.fulfill({ status: 200, json: [] satisfies ProjectDto[] }),
    );
    await page.route('**/api/sandboxes*', (r) =>
      r.fulfill({ status: 200, json: [] satisfies SandboxDto[] }),
    );
    await page.goto('/');

    const { animation, transition } = await probeMs(page);
    expect(animation).toBeLessThan(1);
    expect(transition).toBeLessThan(1);
    // ⛔ 但不是 0：归零会让等 `animationend` 的退场逻辑永远卡住（见文件头）。
    expect(animation).toBeGreaterThan(0);

    await ctx.close();
  });

  /**
   * ⭐ **对照组**：没开这个开关时动效**照常**。
   * ⛔ 少了这一条，把 `globals.css` 里那段媒体查询的 `@media` 条件删掉（变成无条件压掉
   * 所有动效）上面那条依然全绿 —— 而那会把所有用户的动效都干掉，是另一个 bug。
   */
  test('⭐ 没开这个开关 ⇒ 动效照常（媒体查询不能写成无条件）', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'no-preference' });
    const page = await ctx.newPage();
    await stubHealth(page);
    await stubInitialized(page);
    await page.route('**/api/projects', (r) =>
      r.fulfill({ status: 200, json: [] satisfies ProjectDto[] }),
    );
    await page.route('**/api/sandboxes*', (r) =>
      r.fulfill({ status: 200, json: [] satisfies SandboxDto[] }),
    );
    await page.goto('/');

    const { animation, transition } = await probeMs(page);
    expect(animation).toBeGreaterThan(100);
    expect(transition).toBeGreaterThan(10);

    await ctx.close();
  });
});
