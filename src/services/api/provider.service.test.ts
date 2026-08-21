// @vitest-environment node
// API 集成测试用 node 环境：MSW/node 对 undici fetch 的拦截在 node 环境下最稳定（与 health.service.test 同规格）。
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { listProviders } from '@/services/api/provider.service';
import { ApiErrorException } from '@/services/api/apiError';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

describe('provider.service（开放 registry 只读投影）', () => {
  it('GET /api/providers → 扁平数组（含 capabilities 与 isDefault）', async () => {
    const providers = await listProviders();
    expect(providers.map((p) => p.name)).toEqual(['aio', 'boxlite']);
    expect(providers.find((p) => p.isDefault)?.name).toBe('aio');
    expect(providers[0]?.capabilities.spawnTty).toBe(true);
  });

  it('第三方 provider 原样透传（service 不过滤、不枚举、不补默认）', async () => {
    server.use(
      http.get(`${API_BASE}/api/providers`, () =>
        HttpResponse.json([
          {
            name: 'acme',
            capabilities: {
              spawnTty: true,
              volumeMount: false,
              updateResources: false,
              pauseResume: false,
              snapshot: false,
              watchEvents: true,
            },
            isDefault: true,
          },
        ]),
      ),
    );
    const providers = await listProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]?.name).toBe('acme');
    expect(providers[0]?.isDefault).toBe(true);
  });

  it('非 2xx → ApiErrorException（承载后端信封）', async () => {
    server.use(
      http.get(`${API_BASE}/api/providers`, () =>
        HttpResponse.json(
          { code: 'INTERNAL', message: 'registry 不可用', retryable: true },
          { status: 500 },
        ),
      ),
    );
    await expect(listProviders()).rejects.toBeInstanceOf(ApiErrorException);
  });
});
