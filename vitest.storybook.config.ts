// Storybook 交互测试（12 §2.3）：Vitest browser mode 跑每个 story 的 play + 渲染。
//
// ⚠️ 这一句此前写的是「Storybook 交互 / **a11y 测试**」—— 那半句是**假的**，而且正是它
// 让人以为 a11y 有人守着（2026-09-15 实证：造一个必报违规的 story，照样全绿）。
// 原因见 `.storybook/vitest.setup.ts` 里的长注释；⛔ 不要把 a11y 三个字加回这一行。
// **真正的 a11y 门禁在 `e2e/a11y.spec.ts`**（真实渲染整页 + 直接跑 axe-core）。
// 与单测隔离；CI 第 2 道门与单测并行（12 §5）。本地运行前需 `pnpm exec playwright install chromium`。
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // 显式锁定 root 到仓库根，确保 storybookTest 的 relative(vitestRoot, id) 匹配稳定。
  root: dirname,
  plugins: [storybookTest({ configDir: path.join(dirname, '.storybook') })],
  resolve: {
    alias: { '@': path.join(dirname, 'src') },
  },
  test: {
    name: 'storybook',
    setupFiles: ['./.storybook/vitest.setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
    },
  },
});
