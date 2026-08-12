// Storybook 交互 / a11y 测试（12 §2.3）：Vitest browser mode 跑每个 story 的 play + 渲染。
// 与单测隔离；CI 第 2 道门与单测并行（12 §5）。本地运行前需 `pnpm exec playwright install chromium`。
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
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
      name: 'chromium',
    },
  },
});
