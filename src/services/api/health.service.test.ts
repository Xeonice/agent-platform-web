// @vitest-environment node
// API 集成测试用 node 环境：MSW/node 对 undici fetch 的拦截在 node 环境下最稳定（jsdom 下 fetch 可能绕过拦截器）。
import { describe, it, expect } from 'vitest';
import { getHealth } from '@/services/api/health.service';

// 集成：typed openapi-fetch 调用 → 走 msw node mock（vitest.setup.ts 已启动 server）。
describe('health.service (冒烟切片：typed service + msw)', () => {
  it('GET /api/health 返回被生成类型约束的响应', async () => {
    const health = await getHealth();
    expect(health.status).toBe('ok');
    expect(health.version).toBe('0.0.0-mock');
    expect(typeof health.schemaHash).toBe('string');
  });
});
