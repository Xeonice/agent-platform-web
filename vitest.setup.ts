// 单测全局 setup：jest-dom 断言 + MSW node server（12 §3）。
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './src/mocks/node';

/**
 * ⚠️ 测试**不跑在 Next 下**，没有 `/api/*` rewrites，而 node 的 `fetch` 不接受相对路径。
 * 生产兜底是空串（同源，见 `services/api/client.ts`），所以这里必须显式给一个绝对 origin
 * ——测试自己声明它的替身地址，而不是靠生产兜底值恰好是个绝对地址。
 * 用 `??=`：单个测试文件想换 origin 时仍可自己先设。
 */
process.env['NEXT_PUBLIC_API_BASE_URL'] ??= 'http://localhost:3001';

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});
