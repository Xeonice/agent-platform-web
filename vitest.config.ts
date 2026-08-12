// 单元 / 集成测试（12 §3、§5）：hooks 状态机、services 协议编解码、lib 纯函数、stores partialize 快照。
// 与 Storybook 浏览器测试隔离（后者见 vitest.storybook.config.ts），保证 `pnpm test` 稳定绿。
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.join(dirname, 'src') },
  },
  test: {
    name: 'unit',
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.stories.tsx', 'src/types/**', 'src/mocks/**'],
    },
  },
});
