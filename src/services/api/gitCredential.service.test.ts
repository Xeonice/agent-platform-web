// @vitest-environment node
// Git 凭证 REST 集成测试（node 环境，MSW/undici 拦截最稳，对齐 project.service.test，F21-3 §7.1）。
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import {
  listGitCredentials,
  saveGitCredential,
  testGitCredential,
  revokeGitCredential,
} from '@/services/api/gitCredential.service';
import { ApiErrorException } from '@/services/api/apiError';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

describe('gitCredential.service（F21-3 §8）', () => {
  it('list() 拼 GET /api/credentials?kind=git（kind 恒为字面量 git，不由调用方传入）', async () => {
    let seenUrl = '';
    let seenCredentials: RequestCredentials | undefined;
    server.use(
      http.get(`${API_BASE}/api/credentials`, ({ request }) => {
        seenUrl = request.url;
        seenCredentials = request.credentials;
        return HttpResponse.json([
          {
            id: 'gc-1',
            kind: 'git',
            type: 'https-token',
            maskedIdentifier: 'ghp_…ab12',
            platform: 'github',
            allowedHosts: ['github.com'],
            createdAt: new Date().toISOString(),
          },
        ]);
      }),
    );

    const list = await listGitCredentials();
    expect(new URL(seenUrl).searchParams.get('kind')).toBe('git');
    expect(seenCredentials).toBe('include');
    // list() 返回值键名白名单——绝不含任何明文字段（私钥/token 原文）。
    for (const item of list) {
      expect(Object.keys(item).sort()).toEqual(
        expect.arrayContaining([
          'id',
          'kind',
          'type',
          'maskedIdentifier',
          'allowedHosts',
          'createdAt',
        ]),
      );
      expect(item).not.toHaveProperty('secret');
      expect(item).not.toHaveProperty('privateKey');
      expect(item).not.toHaveProperty('token');
      // allowedHosts 为明示数组
      expect(Array.isArray(item.allowedHosts)).toBe(true);
    }
  });

  it('save(https-token) → POST /api/credentials/git，body 带 token + platform + 非空 allowedHosts', async () => {
    let seenBody: unknown;
    server.use(
      http.post(`${API_BASE}/api/credentials/git`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json(
          {
            id: 'gc-2',
            kind: 'git',
            type: 'https-token',
            maskedIdentifier: 'ghp_…ab12',
            platform: 'github',
            allowedHosts: ['github.com'],
            createdAt: new Date().toISOString(),
          },
          { status: 201 },
        );
      }),
    );

    await saveGitCredential({
      type: 'https-token',
      secret: 'ghp_supersecrettoken_ab12',
      platform: 'github',
      allowedHosts: ['github.com'],
    });
    expect(seenBody).toMatchObject({
      type: 'https-token',
      platform: 'github',
      allowedHosts: ['github.com'],
    });
    // 明文 secret 只在请求体传输（本条断言 body 带上，掩码/不回读由 list 分支保证）。
    expect(seenBody).toHaveProperty('secret');
  });

  it('save(ssh-key) → body 传私钥、allowedHosts 空数组（SSH 用 known_hosts 不用白名单）', async () => {
    let seenBody: unknown;
    server.use(
      http.post(`${API_BASE}/api/credentials/git`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json(
          {
            id: 'gc-3',
            kind: 'git',
            type: 'ssh-key',
            maskedIdentifier: 'SHA256:abc123',
            allowedHosts: [],
            createdAt: new Date().toISOString(),
          },
          { status: 201 },
        );
      }),
    );

    await saveGitCredential({
      type: 'ssh-key',
      secret: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
      allowedHosts: [],
    });
    expect(seenBody).toMatchObject({ type: 'ssh-key', allowedHosts: [] });
  });

  it('test(inline) 拼 POST /api/credentials/git/test，body 判别联合 source=inline（存前测带 secret）', async () => {
    let seenBody: unknown;
    server.use(
      http.post(`${API_BASE}/api/credentials/git/test`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json({ ok: false, errorCode: 'CLONE_FAILED_PERMISSION' });
      }),
    );
    const result = await testGitCredential({
      source: 'inline',
      type: 'https-token',
      secret: 'ghp_x_ab12',
      platform: 'github',
      allowedHosts: ['github.com'],
      repoUrl: 'https://github.com/acme/web.git',
    });
    expect(seenBody).toMatchObject({ source: 'inline', type: 'https-token', secret: 'ghp_x_ab12' });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('CLONE_FAILED_PERMISSION');
    // 契约：不透传任何 ref 名/分支名
    expect(result).not.toHaveProperty('refs');
    expect(result).not.toHaveProperty('branches');
  });

  it('test(stored) 拼 POST /api/credentials/git/test，body 判别联合 source=stored（卡片测带 credentialId）', async () => {
    let seenBody: unknown;
    server.use(
      http.post(`${API_BASE}/api/credentials/git/test`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json({ ok: true });
      }),
    );
    const result = await testGitCredential({ source: 'stored', credentialId: 'gc-1' });
    expect(seenBody).toMatchObject({ source: 'stored', credentialId: 'gc-1' });
    expect(result.ok).toBe(true);
  });

  it('revoke() 拼 DELETE /api/credentials/git/:id', async () => {
    let seenMethod = '';
    let seenPath = '';
    server.use(
      http.delete(`${API_BASE}/api/credentials/git/:id`, ({ request, params }) => {
        seenMethod = request.method;
        seenPath = String(params['id']);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await revokeGitCredential('gc-9');
    expect(seenMethod).toBe('DELETE');
    expect(seenPath).toBe('gc-9');
  });

  it('非 2xx → 抛 ApiErrorException（承载信封）', async () => {
    server.use(
      http.post(`${API_BASE}/api/credentials/git`, () =>
        HttpResponse.json(
          { code: 'VALIDATION', message: 'host 白名单不能为空', retryable: false },
          { status: 400 },
        ),
      ),
    );
    await expect(
      saveGitCredential({ type: 'https-token', secret: 't', allowedHosts: [] }),
    ).rejects.toBeInstanceOf(ApiErrorException);
  });
});
