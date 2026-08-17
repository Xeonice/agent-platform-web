// @vitest-environment node
// API 集成测试用 node 环境（MSW/node 对 undici fetch 拦截最稳）。
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { createSandbox } from '@/services/api/sandbox.service';
import { ApiErrorException } from '@/services/api/apiError';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

describe('sandbox.service (S1 建沙箱)', () => {
  it('POST /api/sandboxes 返回被生成类型约束的 SandboxResponseDto', async () => {
    const sb = await createSandbox({ projectId: 'default', runtime: 'shell', provider: 'aio' });
    expect(typeof sb.id).toBe('string');
    expect(sb.status).toBe('running');
    expect(sb.projectId).toBe('default');
    // status 受生成的 12 值 enum 约束（编译期已保证），运行期再校验取值合法
    expect([
      'pending',
      'scheduling',
      'preparing-workspace',
      'creating',
      'starting',
      'running',
      'idle',
      'stopping',
      'stopped',
      'failed',
      'destroying',
      'destroyed',
    ]).toContain(sb.status);
  });

  it('非 2xx → 抛 ApiErrorException（承载后端 ErrorEnvelope）', async () => {
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, () =>
        HttpResponse.json(
          { code: 'PROVIDER_UNAVAILABLE', message: '档位不可用', retryable: false },
          { status: 503 },
        ),
      ),
    );
    await expect(
      createSandbox({ projectId: 'default', runtime: 'shell', provider: 'boxlite' }),
    ).rejects.toBeInstanceOf(ApiErrorException);
  });
});
