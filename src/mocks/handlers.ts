// MSW REST handlers（供 Storybook / 单测 / dev 复用，12 §2.2）。
//
// ★ 本文件受 **12 §3.4「替身的形状可以手写，替身的值不能凭空」** 约束，两条纪律：
//
//  ① **每个工厂都有显式返回类型**。返回裸对象字面量时，后端给 DTO 加一个必填字段 →
//     生成类型更新 → 生产代码报红，而 mock 会**静默**少一个字段，dev/MSW 里看着一切正常。
//     `SandboxResponseDto.provider` 就是这么漏掉的：本文件两处沙箱响应从来没带过它。
//  ② **取自后端开放集的值（runtime / provider / 错误码 / 状态枚举）必须是真实来源里存在的取值。**
//     反面教材（14 §10）：这里两处曾返回 `runtime: 'shell'`，与当时前端硬编码的 `'shell'`
//     完全自洽 ⇒ 单测 / Storybook / Playwright 全绿，而真后端注册表里根本没有这个键。
//     现在的形状让"凭空造值"在结构上就做不到：两个开放集各有**唯一一份**注册表常量（见下），
//     所有 handler 的取值都从它派生，`handlers.test.ts` 再从外部把这条不变量钉住。
import { http, HttpResponse } from 'msw';
import type { ProjectDto } from '@/types/project';
import type { MaskedGitCredential, StoreGitCredentialResponse } from '@/types/gitCredential';
import type {
  AuthChallenge,
  AuthStatusResponse,
  RuntimeCredentialResult,
  RuntimeDto,
  RuntimeSettings,
} from '@/types/runtimeCredential';
import type { SandboxDto, SandboxProviderCapabilities, SandboxProviderDto } from '@/types/sandbox';
import type { AgentTaskDto } from '@/types/task';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

// ————————————————————————————————————————————————————————————————
// 两个**开放注册表**的唯一一份替身数据。
//
// 值的依据（12 §3.4 落地要求 3：声称"与后端一致"就得给得出依据）：
//  · runtime  —— `api/packages/modules/runtime/src/infrastructure/adapters/{codex,claude-code}/*.adapter.ts`
//                 里的 `readonly id / displayName / vendor` 与 `getAuthMethods()`；
//  · provider —— `api/packages/modules/sandbox/src/infrastructure/registry/provider-registry.ts`
//                 （`private defaultName = 'aio'`）与 `sandbox.module.ts` 注册的 aio / boxlite。
//
// 它们**是开放集**：第三方在运行时注册的键不在这份名单里，也永远不该被前端枚举。
// 这份名单只是 dev/测试替身"手上恰好有的那几个真实取值"，不是闭集声明。
// ————————————————————————————————————————————————————————————————

const RUNTIME_IDS = { codex: 'codex', claudeCode: 'claude-code' } as const;
const PROVIDER_NAMES = { aio: 'aio', boxlite: 'boxlite' } as const;

/** dev/Storybook 里"服务端默认档"：runtime 取注册表第一项（契约无 isDefault），provider 取 isDefault 那项。 */
const DEFAULT_RUNTIME_ID: string = RUNTIME_IDS.codex;
const DEFAULT_RUNTIME_LABEL = 'Codex';
const DEFAULT_PROVIDER_NAME: string = PROVIDER_NAMES.aio;

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** 生成一份 provider 能力位（默认全能力开启，按需覆盖）——形状即生成物 ProviderResponseDto.capabilities。 */
function providerCapabilities(
  overrides: Partial<SandboxProviderCapabilities> = {},
): SandboxProviderCapabilities {
  return {
    spawnTty: true,
    volumeMount: true,
    updateResources: true,
    pauseResume: true,
    snapshot: true,
    watchEvents: true,
    headlessTask: false,
    ...overrides,
  };
}

/**
 * provider registry（`GET /api/providers` → ProviderResponseDto[]）：后端开放 registry 的只读投影。
 * S6：aio 打开 headlessTask（dev 能走通无头链路），boxlite 保持 false ——
 * 这样"档位不支持无头任务 → 入口置灰 + 原因"那条路径在 dev 里也看得见。
 */
const PROVIDER_REGISTRY: readonly SandboxProviderDto[] = [
  {
    name: PROVIDER_NAMES.aio,
    capabilities: providerCapabilities({ headlessTask: true }),
    isDefault: true,
  },
  {
    name: PROVIDER_NAMES.boxlite,
    capabilities: providerCapabilities({ pauseResume: false, snapshot: false }),
    isDefault: false,
  },
];

/** runtime 卡片工厂（显式返回类型：RuntimeResponseDto 加必填字段时这里编译期红）。 */
function runtimeDto(overrides: Partial<RuntimeDto> & Pick<RuntimeDto, 'id'>): RuntimeDto {
  return {
    displayName: overrides.id,
    vendor: 'ACME',
    authMethods: ['api-key'],
    credentialStatus: 'none',
    credentials: [],
    ...overrides,
  };
}

/**
 * runtime registry（`GET /api/runtimes` → RuntimeResponseDto[]）：卡片元数据 + 凭证状态聚合 +
 * 逐模式明细（F21-3 §4）。Codex 走 device-code、帐号授权生效、剩 6 天预警；Claude Code 未配置。
 * **这份数组同时是建沙箱时 runtime 单选的数据源**（14 §10.3 ①），顺序即服务端表达的默认档。
 */
const RUNTIME_REGISTRY: readonly RuntimeDto[] = [
  runtimeDto({
    id: RUNTIME_IDS.codex,
    displayName: DEFAULT_RUNTIME_LABEL,
    vendor: 'OpenAI',
    authMethods: ['oauth-device', 'api-key'],
    credentialStatus: 'expiring',
    maskedIdentifier: 'a***@gmail.com',
    expiresAt: isoIn(6 * DAY),
    activeAuthMethod: 'account',
    // 逐模式明细：帐号授权已配置（剩 6 天预警）；API Key 未配置 → 不在数组里。
    credentials: [
      {
        credentialId: 'rc-codex-account',
        mode: 'account',
        maskedIdentifier: 'a***@gmail.com',
        status: 'expiring',
        expiresAt: isoIn(6 * DAY),
        lastUsedAt: isoIn(-2 * HOUR),
      },
    ],
  }),
  runtimeDto({
    id: RUNTIME_IDS.claudeCode,
    displayName: 'Claude Code',
    vendor: 'Anthropic',
    authMethods: ['setup-token', 'api-key'],
    credentialStatus: 'none',
    credentials: [],
  }),
];

/** 生成一个符合 ProjectResponseDto 必填形状的对象。 */
function projectDto(overrides: Partial<ProjectDto> & Pick<ProjectDto, 'id' | 'name'>): ProjectDto {
  return {
    sourceType: 'empty',
    cloneStatus: 'ready',
    cloneErrorCode: null,
    taskCount: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * 生成一份 SandboxResponseDto。
 *
 * ⚠️ `runtime` / `provider` 一律从上面的注册表常量取默认值 —— **这两个字段就是 14 §10 那个 bug 的现场**：
 * 旧版本这里写死 `runtime: 'shell'`（后端注册表里没有这个键）且**根本没有 `provider` 字段**
 * （DTO 里它是必填，裸字面量让 tsc 一句话都没说）。显式返回类型 + 注册表常量把两个坑一起封了。
 */
function sandboxDto(overrides: Partial<SandboxDto> & Pick<SandboxDto, 'id'>): SandboxDto {
  return {
    projectId: 'proj-demo',
    runtime: DEFAULT_RUNTIME_ID,
    provider: DEFAULT_PROVIDER_NAME,
    name: defaultTaskName(undefined),
    status: 'running',
    headless: false,
    timeoutMinutes: 120,
    idleTimeoutSec: 1800,
    waitingInput: false,
    version: 1,
    ...overrides,
  };
}

/**
 * 默认任务名（`SandboxResponseDto.name`）。**移植自后端的领域策略**
 * `api/packages/modules/sandbox/src/domain/services/task-name.policy.ts`：
 * 首个非空行 → 前 20 个**码点** → 被截断或后面还有非空行则补 `…`；无指令 ⇒ `'<Runtime> · <UTC 到分钟>'`。
 *
 * 这段之所以值得在 mock 里写对：默认任务名是 `initialPrompt` **唯一**的展示消费者
 * （DTO 刻意不回显指令，T-1），前端拿到什么用什么。mock 里算错，就等于替身替前端确认了一条错的规则。
 */
function defaultTaskName(prompt: string | undefined, runtimeLabel = DEFAULT_RUNTIME_LABEL): string {
  const fromPrompt = nameFromPrompt(prompt);
  if (fromPrompt !== undefined) return fromPrompt;
  // 后端刻意用 UTC（它没有用户时区），格式 `YYYY-MM-DD HH:mm`。
  const iso = new Date().toISOString();
  return `${runtimeLabel} · ${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function nameFromPrompt(prompt: string | undefined): string | undefined {
  if (prompt === undefined) return undefined;
  const lines = prompt.split('\n');
  const index = lines.findIndex((l) => l.trim() !== '');
  if (index < 0) return undefined; // 全空白的指令 ⇒ 回落到 `<Runtime> · <时间>`
  const points = Array.from(lines[index]?.trim() ?? '');
  const droppedMore = lines.slice(index + 1).some((l) => l.trim() !== '');
  const head = points.slice(0, 20).join('');
  return points.length > 20 || droppedMore ? `${head}…` : head;
}

/**
 * 生成一份 AgentTaskDto（S6 无头 Task）。
 *
 * ⚠️ 返回值**必须**标注成 `AgentTaskDto`：不标注时它只是个对象字面量，
 * 后端给 DTO 加一个必填字段 → 生成类型更新 → 真实代码报红，而 mock 会**静默**少一个字段，
 * dev/MSW 里看着一切正常。标注之后，缺字段在 tsc 阶段就红。
 */
function agentTaskDto(overrides: Partial<AgentTaskDto>): AgentTaskDto {
  return {
    id: 'task-dev-1',
    sandboxId: 'sb-dev',
    runtime: DEFAULT_RUNTIME_ID,
    status: 'running',
    // 有它前端才算得出「还剩多久」（只有 startedAt 只能显示"已经跑了多久"）。
    timeoutMinutes: 120,
    lastSeq: 0,
    artifacts: [],
    startedAt: isoIn(-60_000),
    ...overrides,
  };
}

/** Git 凭证掩码卡片（明文永不回读）。 */
function gitCredentialDto(
  overrides: Partial<MaskedGitCredential> & Pick<MaskedGitCredential, 'id'>,
): MaskedGitCredential {
  return {
    kind: 'git',
    type: 'https-token',
    maskedIdentifier: 'ghp_…ab12',
    platform: 'github',
    allowedHosts: ['github.com'],
    lastUsedAt: isoIn(-2 * HOUR),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * 读请求体里的一个**字符串**字段（MSW 侧的 JSON 边界）。
 * 只认字符串：非字符串一律当"没给"，免得 `String(someObject)` 悄悄产出 `[object Object]`
 * 再被当成一个合法的 runtime/provider 键回带出去——那正是"替身凭空造值"的另一种形态。
 */
function stringField(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null || !(key in body)) return undefined;
  const value: unknown = Reflect.get(body, key);
  return typeof value === 'string' ? value : undefined;
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
    const isGit = stringField(body, 'sourceType') === 'git';
    return HttpResponse.json(
      projectDto({
        id: `proj-${String(Date.now())}`,
        name: stringField(body, 'name') ?? '新项目',
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
    HttpResponse.json([gitCredentialDto({ id: 'gc-demo' })]),
  ),
  http.post(`${API_BASE}/api/credentials/git`, async ({ request }) => {
    const body: unknown = await request.json().catch(() => ({}));
    const isSsh = stringField(body, 'type') === 'ssh-key';
    // 保存响应仅回 id + maskedIdentifier（StoreGitCredentialResponseDto，不回明文）。
    const saved: StoreGitCredentialResponse = {
      id: `gc-${String(Date.now())}`,
      maskedIdentifier: isSsh ? 'SHA256:abc123def456' : 'ghp_…ab12',
    };
    return HttpResponse.json(saved, { status: 201 });
  }),
  http.post(`${API_BASE}/api/credentials/git/test`, () => HttpResponse.json({ ok: true })),
  http.delete(`${API_BASE}/api/credentials/git/:id`, () => new HttpResponse(null, { status: 204 })),

  // Runtime 注册表 + 凭证聚合（F21-3 §4）。同一份数组同时喂「凭证页 runtime 分区」与「建沙箱的 runtime 单选」。
  http.get(`${API_BASE}/api/runtimes`, () => HttpResponse.json(RUNTIME_REGISTRY)),

  // 单 runtime 状态（重授权后局部刷新，回同构 RuntimeDto）：从注册表里取那一项再改写状态，
  // **不另造一份**（旧版本这里无论 :rt 是谁都回 Codex 的卡片，等于替身自己在撒谎）。
  http.get(`${API_BASE}/api/runtimes/:rt/credentials/status`, ({ params }) => {
    const id = String(params['rt']);
    const known = RUNTIME_REGISTRY.find((r) => r.id === id);
    if (known === undefined) {
      // 后端对未注册的 runtime 是 404（runtime-application.service：`unknown runtime '<id>'`）。
      return HttpResponse.json(
        { code: 'NOT_FOUND', message: `unknown runtime '${id}'`, retryable: false },
        { status: 404 },
      );
    }
    return HttpResponse.json(
      runtimeDto({
        ...known,
        credentialStatus: 'active',
        activeAuthMethod: 'account',
        credentials: known.credentials.map((c) => ({ ...c, status: 'ok' })),
      }),
    );
  }),
  // device-code / setup-token 发起挑战（method 决定 kind）。
  http.post(`${API_BASE}/api/runtimes/:rt/auth/begin`, async ({ request }) => {
    const body: unknown = await request.json().catch(() => ({}));
    if (stringField(body, 'method') === 'setup-token') {
      const challenge: AuthChallenge = {
        challengeRef: 'chal-setup',
        method: 'setup-token',
        kind: 'paste-prompt',
        verificationUrl: 'https://claude.ai/setup-token',
        instructions: '在浏览器完成授权后，复制授权码粘贴回来。',
      };
      return HttpResponse.json(challenge);
    }
    const challenge: AuthChallenge = {
      challengeRef: 'chal-device',
      method: 'oauth-device',
      kind: 'device-code',
      userCode: 'WDJB-MJHT',
      verificationUrl: 'https://openai.com/device',
      expiresAt: isoIn(15 * 60 * 1000),
      instructions: '在验证页面输入设备码完成授权。',
    };
    return HttpResponse.json(challenge);
  }),
  // 轮询：dev 直接回 success（掩码帐号）。
  http.get(`${API_BASE}/api/runtimes/:rt/auth/status`, () => {
    const status: AuthStatusResponse = { status: 'success', maskedIdentifier: 'a***@gmail.com' };
    return HttpResponse.json(status);
  }),
  http.post(`${API_BASE}/api/runtimes/:rt/auth/complete`, () => {
    const result: RuntimeCredentialResult = { maskedIdentifier: 'a***@gmail.com' };
    return HttpResponse.json(result);
  }),
  http.post(`${API_BASE}/api/runtimes/:rt/credentials/secret`, () => {
    const result: RuntimeCredentialResult = { maskedIdentifier: 'sk-...ab12' };
    return HttpResponse.json(result);
  }),
  http.put(`${API_BASE}/api/runtimes/:rt/auth-mode`, ({ params }) => {
    const settings: RuntimeSettings = {
      runtimeId: String(params['rt']),
      activeAuthMethod: 'api-key',
    };
    return HttpResponse.json(settings);
  }),
  http.delete(
    `${API_BASE}/api/runtimes/:rt/credentials/:credentialId`,
    () => new HttpResponse(null, { status: 204 }),
  ),

  // provider registry（GET /api/providers → ProviderResponseDto[]）：后端开放 registry 的只读投影，
  // 前端「运行档位」单选由它驱动；默认档由数组项的 isDefault 标记（无顶层字段）。
  // 第三方 provider 只要出现在这份响应里，UI 自动多一项。
  http.get(`${API_BASE}/api/providers`, () => HttpResponse.json(PROVIDER_REGISTRY)),

  // 单个沙箱（刷新恢复的唯一来源）：任务名 + 失败原因（failureCode/failureMessage 仅 failed 时出现）。
  http.get(`${API_BASE}/api/sandboxes/:id`, ({ params }) =>
    HttpResponse.json(sandboxDto({ id: String(params['id']), name: 'dev 恢复的任务' })),
  ),

  // 建沙箱（发起 Task）：回一个符合 SandboxResponseDto 形状的 201。
  // `name` = **后端派生的默认任务名**（10 §7.3 / P21-1 §9）——这里同样由"服务端"算，
  // 前端拿到什么用什么、绝不自己再派生一份（TASK-LAUNCH-DECISIONS T-1）。
  // ⚠️ mock 也**不回显** initialPrompt（DTO 刻意不含该字段）。
  // ⚠️ 请求里的 runtime/provider 原样回带：它们是开放集，替身不许把用户选的键"纠正"成自己认识的那个。
  http.post(`${API_BASE}/api/sandboxes`, async ({ request }) => {
    const body: unknown = await request.json().catch(() => ({}));
    const provider = stringField(body, 'provider');
    const projectId = stringField(body, 'projectId');
    const runtime = stringField(body, 'runtime') ?? DEFAULT_RUNTIME_ID;
    const label = RUNTIME_REGISTRY.find((r) => r.id === runtime)?.displayName ?? runtime;
    return HttpResponse.json(
      sandboxDto({
        id: `mock-${String(Date.now())}`,
        runtime,
        ...(provider === undefined ? {} : { provider }),
        ...(projectId === undefined ? {} : { projectId }),
        name: defaultTaskName(stringField(body, 'initialPrompt'), label),
      }),
      { status: 201 },
    );
  }),

  // ————————————————————————————————————————————————————————————————
  // S6 无头 Task。openapi 已同步 ⇒ 形状以**生成类型**为准（agentTaskDto 的返回值已咬合 DTO）；
  // 本组只是 dev fixture，用来在没有真后端时把界面跑通。
  // 注意：输出流走 /tasks socket.io，MSW 不拦截 ⇒ dev 里输出面板需要真后端才有内容。
  // ————————————————————————————————————————————————————————————————

  // 发起：202 + **整个 AgentTaskDto**（不是 { taskId }）。**不回显 prompt**——与 initialPrompt 同一纪律。
  http.post(`${API_BASE}/api/sandboxes/:id/runtimes/:rt/tasks`, ({ params }) =>
    HttpResponse.json(
      agentTaskDto({
        id: `task-${String(Date.now())}`,
        sandboxId: String(params['id']),
        runtime: String(params['rt']),
        status: 'running',
      }),
      { status: 202 },
    ),
  ),

  // 任务列表（**刷新恢复的权威来源**，startedAt 倒序）。dev 给一个已完成的任务：
  // 退出码 0 + 两份产物 + sessionRef（据此可点「接着聊」）。
  http.get(`${API_BASE}/api/sandboxes/:id/tasks`, ({ params }) =>
    HttpResponse.json([
      agentTaskDto({
        id: 'task-dev-1',
        sandboxId: String(params['id']),
        status: 'succeeded',
        exitCode: 0,
        sessionRef: 'sess-dev-0001',
        finishedAt: new Date().toISOString(),
        artifacts: [
          { name: 'summary.md', size: 2048, modifiedAt: new Date().toISOString() },
          { name: 'patch.diff', size: 131072, modifiedAt: new Date().toISOString() },
        ],
      }),
    ]),
  ),

  // 单条详情（前端当前不用它，列表已是权威来源；保留以便联调时直接打）。
  http.get(`${API_BASE}/api/sandboxes/:id/tasks/:taskId`, ({ params }) =>
    HttpResponse.json(
      agentTaskDto({ id: String(params['taskId']), sandboxId: String(params['id']) }),
    ),
  ),

  // 终止（两阶段强杀）：202 只表示受理，终态由 /tasks 的 exit 帧宣告。
  http.post(`${API_BASE}/api/sandboxes/:id/tasks/:taskId/cancel`, ({ params }) =>
    HttpResponse.json(
      agentTaskDto({
        id: String(params['taskId']),
        sandboxId: String(params['id']),
        status: 'running',
      }),
      { status: 202 },
    ),
  ),

  // 产物下载：二进制流（dev 给一段纯文本，够验证"取 Blob → 存盘"这条路）。
  http.get(`${API_BASE}/api/sandboxes/:id/tasks/:taskId/artifacts/:name`, ({ params }) =>
    HttpResponse.text(`# ${String(params['name'])}\n\ndev mock artifact\n`, {
      headers: { 'content-type': 'application/octet-stream' },
    }),
  ),
];
