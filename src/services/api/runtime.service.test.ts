// @vitest-environment node
// Runtime 鉴权 REST 集成测试（node 环境，MSW/undici 拦截，对齐 gitCredential.service.test，F21-3 §7.1）。
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import {
  listRuntimes,
  beginAuth,
  pollAuthStatus,
  completeAuth,
  saveSecret,
  setAuthMode,
  revokeRuntimeCredential,
} from '@/services/api/runtime.service';
import { ApiErrorException } from '@/services/api/apiError';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

/** 所有鉴权路径均不含 sandbox 段（05 §2 决策 A，F21-3 §7.1 正则断言）。 */
function assertNoSandboxSegment(url: string): void {
  expect(/\/sandboxes?\//.test(new URL(url).pathname)).toBe(false);
}

describe('runtime.service（07 §6.3 端点表）', () => {
  it('listRuntimes 拼 GET /api/runtimes，带 cookie', async () => {
    let seenUrl = '';
    let seenCreds: RequestCredentials | undefined;
    server.use(
      http.get(`${API_BASE}/api/runtimes`, ({ request }) => {
        seenUrl = request.url;
        seenCreds = request.credentials;
        return HttpResponse.json([]);
      }),
    );
    await listRuntimes();
    expect(new URL(seenUrl).pathname).toBe('/api/runtimes');
    expect(seenCreds).toBe('include');
  });

  it('beginAuth 拼 POST /api/runtimes/:rt/auth/begin，body 含 method（方式）；无 sandbox 段', async () => {
    let seenUrl = '';
    let seenBody: unknown;
    server.use(
      http.post(`${API_BASE}/api/runtimes/:rt/auth/begin`, async ({ request }) => {
        seenUrl = request.url;
        seenBody = await request.json();
        return HttpResponse.json({
          challengeRef: 'c',
          method: 'oauth-device',
          kind: 'device-code',
          instructions: '',
        });
      }),
    );
    await beginAuth('codex', 'oauth-device');
    expect(new URL(seenUrl).pathname).toBe('/api/runtimes/codex/auth/begin');
    expect(seenBody).toEqual({ method: 'oauth-device' });
    assertNoSandboxSegment(seenUrl);
  });

  it('pollAuthStatus 拼 GET /api/runtimes/:rt/auth/status?challengeRef=', async () => {
    let seenUrl = '';
    server.use(
      http.get(`${API_BASE}/api/runtimes/:rt/auth/status`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json({ status: 'pending' });
      }),
    );
    await pollAuthStatus('codex', 'chal-1');
    const url = new URL(seenUrl);
    expect(url.pathname).toBe('/api/runtimes/codex/auth/status');
    expect(url.searchParams.get('challengeRef')).toBe('chal-1');
  });

  it('completeAuth 拼 POST /api/runtimes/:rt/auth/complete，body 含 challengeRef + pastedText', async () => {
    let seenBody: unknown;
    server.use(
      http.post(`${API_BASE}/api/runtimes/:rt/auth/complete`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json({ maskedIdentifier: 'a***@gm' });
      }),
    );
    await completeAuth('claude-code', 'chal-2', 'pasted-code');
    expect(seenBody).toEqual({ challengeRef: 'chal-2', pastedText: 'pasted-code' });
  });

  it('saveSecret body 为 {method:"api-key", secret}（不经 sandbox）', async () => {
    let seenUrl = '';
    let seenBody: unknown;
    server.use(
      http.post(`${API_BASE}/api/runtimes/:rt/credentials/secret`, async ({ request }) => {
        seenUrl = request.url;
        seenBody = await request.json();
        return HttpResponse.json({ maskedIdentifier: 'sk-...ab12' });
      }),
    );
    await saveSecret('codex', 'sk-supersecretab12', 'api-key');
    expect(seenBody).toEqual({ method: 'api-key', secret: 'sk-supersecretab12' });
    assertNoSandboxSegment(seenUrl);
  });

  /**
   * ⭐ `saveSecret` 曾把 `method` **写死**成 `'api-key'`（后端只接这一个值的年代）。
   * 后端打通 `access-token-paste` 之后（04 §8 ★8a），写死会把一个**账号凭证**
   * 存成 API Key 模式 —— `obtained_via` 决定 `mode`（13 §2.5.1），于是用户的订阅
   * token 落进「API Key」那张卡，「帐号授权」永远空着，`setAuthMode('account')` 还会 409。
   *
   * ⛔ 这条钉的就是「method 必须原样发出去」。把签名改回写死时它红。
   */
  it('saveSecret 原样发出调用方给的 method（⛔ 不写死 api-key）', async () => {
    let seenBody: unknown;
    server.use(
      http.post(`${API_BASE}/api/runtimes/:rt/credentials/secret`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json({ maskedIdentifier: 'a***@example.com' });
      }),
    );
    await saveSecret('acme-agent', 'acme_tok_live', 'access-token-paste');
    expect(seenBody).toEqual({ method: 'access-token-paste', secret: 'acme_tok_live' });
  });

  it('setAuthMode 拼 PUT /api/runtimes/:rt/auth-mode 且 body 含 method（不是 mode！P1-1）', async () => {
    let seenUrl = '';
    let seenMethod = '';
    let seenBody: unknown;
    server.use(
      http.put(`${API_BASE}/api/runtimes/:rt/auth-mode`, async ({ request }) => {
        seenUrl = request.url;
        seenMethod = request.method;
        seenBody = await request.json();
        return HttpResponse.json({ activeAuthMethod: 'api-key' });
      }),
    );
    await setAuthMode('codex', 'api-key');
    expect(seenMethod).toBe('PUT');
    expect(new URL(seenUrl).pathname).toBe('/api/runtimes/codex/auth-mode');
    expect(seenBody).toEqual({ method: 'api-key' });
    expect(seenBody).not.toHaveProperty('mode');
  });

  it('revokeRuntimeCredential 拼 DELETE /api/runtimes/:rt/credentials/:credentialId', async () => {
    let seenMethod = '';
    let seenPath = '';
    server.use(
      http.delete(`${API_BASE}/api/runtimes/:rt/credentials/:credentialId`, ({ request }) => {
        seenMethod = request.method;
        seenPath = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await revokeRuntimeCredential('codex', 'rc-9');
    expect(seenMethod).toBe('DELETE');
    expect(seenPath).toBe('/api/runtimes/codex/credentials/rc-9');
  });

  it('非 2xx → 抛 ApiErrorException（承载信封）', async () => {
    server.use(
      http.get(`${API_BASE}/api/runtimes`, () =>
        HttpResponse.json({ code: 'UNKNOWN', message: '失败', retryable: false }, { status: 500 }),
      ),
    );
    await expect(listRuntimes()).rejects.toBeInstanceOf(ApiErrorException);
  });
});
