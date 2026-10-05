import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    name: 'acceptance',
    environment: 'jsdom',
    globals: true,
    include: ['src/acceptance/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/acceptance/setup.ts'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/{containers,hooks,lib,services,stores,views}/**/*.{ts,tsx}'],
      exclude: ['src/**/*.stories.tsx', 'src/**/__tests__/**'],
    },
  },
});
