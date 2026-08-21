// MSW REST handlers（供 Storybook / 单测 / dev 复用，12 §2.2）。
import { http, HttpResponse } from 'msw';
import type { SandboxProviderCapabilities } from '@/types/sandbox';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

/** 生成一个符合 ProjectResponseDto 必填形状的对象（id/name/sourceType/cloneStatus/cloneErrorCode/taskCount/createdAt）。 */
function projectDto(overrides: {
  id: string;
  name: string;
  sourceType?: 'git' | 'empty';
  cloneStatus: 'cloning' | 'ready' | 'failed';
  taskCount?: number;
}) {
  return {
    id: overrides.id,
    name: overrides.name,
    sourceType: overrides.sourceType ?? 'empty',
    cloneStatus: overrides.cloneStatus,
    cloneErrorCode: null,
    taskCount: overrides.taskCount ?? 0,
    createdAt: new Date().toISOString(),
  };
}

/** 生成一份 provider 能力位（默认全能力开启，按需覆盖）——形状即生成物 ProviderResponseDto.capabilities。 */
function providerCapabilities(overrides: Partial<SandboxProviderCapabilities>) {
  return {
    spawnTty: true,
    volumeMount: true,
    updateResources: true,
    pauseResume: true,
    snapshot: true,
    watchEvents: true,
    ...overrides,
  };
}

export const handlers = [
  // liveness probe：真实契约 GET /api/health 无响应体 schema，getHealth 只读 response.ok/status。
  // 返回空 JSON（openapi-fetch 默认按 json 解析，须是合法 JSON），body 内容不被读取。
  http.get(`${API_BASE}/api/health`, () => HttpResponse.json({}, { status: 200 })),

  // 口令解锁（11 §3.1）：dev 无口令门，直接 204 成功（真实 cookie 由后端 set）。
  http.post(`${API_BASE}/api/access/unlock`, () => new HttpResponse(null, { status: 204 })),

  // 项目列表（10 §7 ProjectResponseDto）：dev 打通「项目树 → 建沙箱」。DTO 不含 repoUrl。
  http.get(`${API_BASE}/api/projects`, () =>
    HttpResponse.json([projectDto({ id: 'proj-demo', name: '示例项目', cloneStatus: 'ready' })], {
      status: 200,
    }),
  ),

  // 新建项目（202 异步）：git → cloning，empty → ready（dev 无 /events，故 empty 秒就绪最省事）。
  http.post(`${API_BASE}/api/projects`, async ({ request }) => {
    const body: unknown = await request.json().catch(() => ({}));
    const sourceType =
      typeof body === 'object' && body !== null && 'sourceType' in body ? body.sourceType : 'empty';
    const name =
      typeof body === 'object' && body !== null && 'name' in body ? String(body.name) : '新项目';
    const isGit = sourceType === 'git';
    return HttpResponse.json(
      projectDto({
        id: `proj-${String(Date.now())}`,
        name,
        sourceType: isGit ? 'git' : 'empty',
        cloneStatus: isGit ? 'cloning' : 'ready',
      }),
      { status: 202 },
    );
  }),

  // retry-clone / convert-to-empty（仅 failed 态；dev 简化为成功）。
  http.post(`${API_BASE}/api/projects/:id/retry-clone`, ({ params }) =>
    HttpResponse.json(
      projectDto({
        id: String(params['id']),
        name: '重试克隆',
        sourceType: 'git',
        cloneStatus: 'cloning',
      }),
      { status: 202 },
    ),
  ),
  http.post(`${API_BASE}/api/projects/:id/convert-to-empty`, ({ params }) =>
    HttpResponse.json(
      projectDto({ id: String(params['id']), name: '转为空项目', cloneStatus: 'ready' }),
      {
        status: 200,
      },
    ),
  ),
  http.delete(`${API_BASE}/api/projects/:id`, () => new HttpResponse(null, { status: 204 })),

  // Git 凭证（F21-3 §8）：dev 打通「凭证页 → 配置 HTTPS Token → 测试 → 保存」链路。明文永不回读。
  http.get(`${API_BASE}/api/credentials`, () =>
    HttpResponse.json([
      {
        id: 'gc-demo',
        kind: 'git',
        type: 'https-token',
        maskedIdentifier: 'ghp_…ab12',
        platform: 'github',
        allowedHosts: ['github.com'],
        lastUsedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      },
    ]),
  ),
  http.post(`${API_BASE}/api/credentials/git`, async ({ request }) => {
    const body: unknown = await request.json().catch(() => ({}));
    const type =
      typeof body === 'object' && body !== null && 'type' in body ? body.type : 'https-token';
    const isSsh = type === 'ssh-key';
    // 保存响应仅回 id + maskedIdentifier（StoreGitCredentialResponseDto，不回明文）。
    return HttpResponse.json(
      {
        id: `gc-${String(Date.now())}`,
        maskedIdentifier: isSsh ? 'SHA256:abc123def456' : 'ghp_…ab12',
      },
      { status: 201 },
    );
  }),
  http.post(`${API_BASE}/api/credentials/git/test`, () => HttpResponse.json({ ok: true })),
  http.delete(`${API_BASE}/api/credentials/git/:id`, () => new HttpResponse(null, { status: 204 })),

  // Runtime 凭证聚合（F21-3 §4，GET /api/runtimes）：Codex（device-code，帐号授权生效、剩 6 天预警）+
  // Claude Code（setup-token，未配置）。dev/Storybook 打通「凭证页 runtime 分区 → 重授权/切模式/吊销」链路。
  http.get(`${API_BASE}/api/runtimes`, () =>
    HttpResponse.json([
      {
        id: 'codex',
        displayName: 'Codex',
        vendor: 'OpenAI',
        authMethods: ['oauth-device', 'api-key'],
        credentialStatus: 'expiring',
        maskedIdentifier: 'a***@gmail.com',
        expiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
        activeAuthMethod: 'account',
        // 逐模式明细：帐号授权已配置（剩 6 天预警）；API Key 未配置 → 不在数组里。
        credentials: [
          {
            credentialId: 'rc-codex-account',
            mode: 'account',
            maskedIdentifier: 'a***@gmail.com',
            status: 'expiring',
            expiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
            lastUsedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          },
        ],
      },
      {
        id: 'claude-code',
        displayName: 'Claude Code',
        vendor: 'Anthropic',
        authMethods: ['setup-token', 'api-key'],
        credentialStatus: 'none',
        credentials: [],
      },
    ]),
  ),
  http.get(`${API_BASE}/api/runtimes/:rt/credentials/status`, ({ params }) =>
    HttpResponse.json({
      id: String(params['rt']),
      displayName: 'Codex',
      vendor: 'OpenAI',
      authMethods: ['oauth-device', 'api-key'],
      credentialStatus: 'active',
      maskedIdentifier: 'a***@gmail.com',
      activeAuthMethod: 'account',
      credentials: [
        {
          credentialId: 'rc-codex-account',
          mode: 'account',
          maskedIdentifier: 'a***@gmail.com',
          status: 'ok',
        },
      ],
    }),
  ),
  // device-code / setup-token 发起挑战（method 决定 kind）。
  http.post(`${API_BASE}/api/runtimes/:rt/auth/begin`, async ({ request }) => {
    const body: unknown = await request.json().catch(() => ({}));
    const method =
      typeof body === 'object' && body !== null && 'method' in body ? body.method : 'oauth-device';
    if (method === 'setup-token') {
      return HttpResponse.json({
        challengeRef: 'chal-setup',
        method: 'setup-token',
        kind: 'paste-prompt',
        verificationUrl: 'https://claude.ai/setup-token',
        instructions: '在浏览器完成授权后，复制授权码粘贴回来。',
      });
    }
    return HttpResponse.json({
      challengeRef: 'chal-device',
      method: 'oauth-device',
      kind: 'device-code',
      userCode: 'WDJB-MJHT',
      verificationUrl: 'https://openai.com/device',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      instructions: '在验证页面输入设备码完成授权。',
    });
  }),
  // 轮询：dev 直接回 success（掩码帐号）。
  http.get(`${API_BASE}/api/runtimes/:rt/auth/status`, () =>
    HttpResponse.json({ status: 'success', maskedIdentifier: 'a***@gmail.com' }),
  ),
  http.post(`${API_BASE}/api/runtimes/:rt/auth/complete`, () =>
    HttpResponse.json({ maskedIdentifier: 'a***@gmail.com' }),
  ),
  http.post(`${API_BASE}/api/runtimes/:rt/credentials/secret`, () =>
    HttpResponse.json({ maskedIdentifier: 'sk-...ab12' }),
  ),
  http.put(`${API_BASE}/api/runtimes/:rt/auth-mode`, ({ params }) =>
    HttpResponse.json({ runtimeId: String(params['rt']), activeAuthMethod: 'api-key' }),
  ),
  http.delete(
    `${API_BASE}/api/runtimes/:rt/credentials/:credentialId`,
    () => new HttpResponse(null, { status: 204 }),
  ),

  // provider registry（GET /api/providers → ProviderResponseDto[]）：后端开放 registry 的只读投影，
  // 前端「运行档位」单选由它驱动；默认档由数组项的 isDefault 标记（无顶层字段）。
  // dev 里给 aio（全能，默认）+ boxlite（轻量，无快照/暂停）；第三方 provider 只要出现在这份响应里，UI 自动多一项。
  http.get(`${API_BASE}/api/providers`, () =>
    HttpResponse.json([
      { name: 'aio', capabilities: providerCapabilities({}), isDefault: true },
      {
        name: 'boxlite',
        capabilities: providerCapabilities({ pauseResume: false, snapshot: false }),
        isDefault: false,
      },
    ]),
  ),

  // S1 建沙箱：回一个符合 SandboxResponseDto 形状的 201（dev 打通"新建沙箱→终端"链路）。
  http.post(`${API_BASE}/api/sandboxes`, () =>
    HttpResponse.json(
      {
        id: `mock-${String(Date.now())}`,
        projectId: 'default',
        runtime: 'shell',
        status: 'running',
        headless: false,
        timeoutMinutes: 120,
        idleTimeoutSec: 1800,
        waitingInput: false,
        version: 1,
      },
      { status: 201 },
    ),
  ),
];
