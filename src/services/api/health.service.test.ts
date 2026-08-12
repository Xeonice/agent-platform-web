// @vitest-environment node
// API 集成测试用 node 环境：MSW/node 对 undici fetch 的拦截在 node 环境下最稳定（jsdom 下 fetch 可能绕过拦截器）。
import { describe, it, expect } from 'vitest';
import { getHealth } from '@/services/api/health.service';

// 集成：typed openapi-fetch 调用真实路径 /api/health → 走 msw node mock（vitest.setup.ts 已启动 server）。
describe('health.service (冒烟切片：typed service + msw)', () => {
  it('GET /api/health 命中 msw mock 并返回 ok', async () => {
    const health = await getHealth();
    expect(health.ok).toBe(true);
    expect(health.status).toBe(200);
  });
});
