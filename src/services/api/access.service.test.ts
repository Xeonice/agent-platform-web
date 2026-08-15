// @vitest-environment node
// 口令解锁 REST 集成测试（node 环境，MSW/undici 拦截最稳，对齐 sandbox.service.test）。
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { submitPasscode } from '@/services/api/access.service';
import { ApiErrorException } from '@/services/api/apiError';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

describe('access.service（口令解锁 11 §3.1）', () => {
  it('POST /api/access/unlock 2xx → resolve（cookie 由后端 set，前端不读）', async () => {
    await expect(submitPasscode('correct-horse')).resolves.toBeUndefined();
  });

  it('携带 credentials（cookie 随请求发送）', async () => {
    let seenCredentials: RequestCredentials | undefined;
    server.use(
      http.post(`${API_BASE}/api/access/unlock`, ({ request }) => {
        seenCredentials = request.credentials;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await submitPasscode('x');
    expect(seenCredentials).toBe('include');
  });

  it('口令错误 401 → 抛 ApiErrorException（承载后端信封）', async () => {
    server.use(
      http.post(`${API_BASE}/api/access/unlock`, () =>
        HttpResponse.json(
          { code: 'INVALID_PASSCODE', message: '口令错误', retryable: false },
          { status: 401 },
        ),
      ),
    );
    await expect(submitPasscode('wrong')).rejects.toBeInstanceOf(ApiErrorException);
  });
});
