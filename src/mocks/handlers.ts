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
import type { SandboxDto, SandboxProviderDto } from '@/types/sandbox';
import type { AgentTaskDto } from '@/types/task';
import type {
  CheckImageUpdateDto,
  ImageManifestDto,
  RegisterImageResponseDto,
  RevalidateOutcomeDto,
  ValidationOutcomeDto,
} from '@/types/image';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

// ————————————————————————————————————————————————————————————————
// 两个**开放注册表**的唯一一份替身数据。
//
// 值的依据（12 §3.4 落地要求 3：声称"与后端一致"就得给得出依据）：
//  · runtime  —— `api/packages/modules/runtime/src/infrastructure/adapters/{codex,claude-code}/*.adapter.ts`
//                 里的 `readonly id / displayName / vendor` 与 `getAuthMethods()`；
//  · provider —— `api/packages/modules/sandbox/src/infrastructure/registry/provider-registry.ts`
//                 的 `hostPreferredProvider()`，与 `sandbox.module.ts` 注册的 aio / boxlite；
//                 能力位逐位抄自两个 provider 类自己声明的 `capabilities`（见 PROVIDER_REGISTRY）。
//
// 它们**是开放集**：第三方在运行时注册的键不在这份名单里，也永远不该被前端枚举。
// 这份名单只是 dev/测试替身"手上恰好有的那几个真实取值"，不是闭集声明。
// ————————————————————————————————————————————————————————————————

const RUNTIME_IDS = { codex: 'codex', claudeCode: 'claude-code' } as const;
const PROVIDER_NAMES = { aio: 'aio', boxlite: 'boxlite' } as const;

/** dev/Storybook 里"服务端默认档"：runtime 取注册表第一项（契约无 isDefault），provider 取 isDefault 那项。 */
const DEFAULT_RUNTIME_ID: string = RUNTIME_IDS.codex;
const DEFAULT_RUNTIME_LABEL = 'Codex';

/**
 * 替身里标 `isDefault` 的那一项。
 *
 * ⚠️ **这个取值是替身自己拍板的，不是对后端的断言。** 后端的默认档已经不再写死：
 * `hostPreferredProvider()` 按宿主平台选——macOS→boxlite（微 VM，走 Apple
 * Hypervisor.framework，原生），Linux→aio（原生 docker，因为
 * `AioSandboxProvider extends DockerContainerBackend`，Mac 上它要 Docker Desktop）。
 * 替身跑在浏览器（dev/Storybook）里根本读不到宿主平台，**不可能**复刻这个判定；
 * 硬猜一个再声称"与后端一致"，正是 12 §3.4 要禁的那种凭空。
 *
 * 所以这里只钉一个稳定取值供 dev 用，并且把话说明白：
 * **任何测试都不许断言"默认档叫 aio"**——那只在 Linux 上碰巧成立（`handlers.test.ts`
 * 因此只钉"恰好一个 isDefault"，不钉名字）。
 */
const DEFAULT_PROVIDER_NAME: string = PROVIDER_NAMES.aio;

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/**
 * provider registry（`GET /api/providers` → ProviderResponseDto[]）：后端开放 registry 的只读投影。
 *
 * ⚠️ **七位能力位一律逐位写全，不走"默认全开 + 少量 override"的工厂。**
 * 此前这里是 `providerCapabilities({ headlessTask: true })` 那种写法，代价是：没被 override
 * 的位悄悄变成"全 true"，于是替身声称 aio 支持 snapshot、boxlite 支持 updateResources——
 * 后端两个类里这三位实际都是 `false`。这正是 14 §10 那个 `runtime: 'shell'` 的同一个病：
 * **一个谁都没写过、却看着很正常的值**。逐位写全 ⇒ 每一位都得有人对着后端源码点头。
 *
 * 值的逐位依据（抄自 provider 类自己声明的 `readonly capabilities`）：
 *  · aio     —— `api/.../infrastructure/providers/aio/aio-sandbox.provider.ts`
 *               （传给 `DockerContainerBackend` 构造器的 `capabilities`）
 *  · boxlite —— `api/.../infrastructure/providers/boxlite/boxlite-sandbox.provider.ts`
 *
 * ⚠️ 两个内置 provider 的 `headlessTask` **现在都是 true**（S6 已落地）。此前这里给
 * boxlite 留 `false`，注释说"这样『档位不支持无头 → 入口置灰 + 原因』在 dev 里也看得见"——
 * 那句话本身就不成立：替身里每个沙箱 DTO 的 `provider` 都是 `DEFAULT_PROVIDER_NAME`，
 * boxlite 的能力位在 dev 里**从来没被读到过**。置灰那条路径由 Storybook
 * （`HeadlessTaskLauncher.view.stories`）与容器单测覆盖，不需要在替身里造一个假的 false。
 */
const PROVIDER_REGISTRY: readonly SandboxProviderDto[] = [
  {
    name: PROVIDER_NAMES.aio,
    capabilities: {
      spawnTty: true,
      volumeMount: true,
      updateResources: true,
      pauseResume: true,
      snapshot: false,
      watchEvents: true,
      headlessTask: true,
    },
    isDefault: DEFAULT_PROVIDER_NAME === PROVIDER_NAMES.aio,
  },
  {
    name: PROVIDER_NAMES.boxlite,
    capabilities: {
      spawnTty: true,
      volumeMount: true,
      updateResources: false,
      pauseResume: false,
      snapshot: false,
      watchEvents: true,
      headlessTask: true,
    },
    isDefault: DEFAULT_PROVIDER_NAME === PROVIDER_NAMES.boxlite,
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
    // updatedAt 在契约里是**必填**（不是可选）——fixture 比契约宽松就会让
    // 「最后同步」那一格的降级分支在测试里永远走不到真实形状。
    updatedAt: new Date().toISOString(),
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

// ————————————————————————————————————————————————————————————————
// 镜像替身（F21-4 §8.1 的 8 个 operation）。
//
// ⚠️ **`supportedRuntimes` 的取值必须来自上面那份 runtime 注册表**（本文件纪律 ②）：
// 向导下拉的过滤规则是 `supportedRuntimes 含所选 runtime`，替身里凭空写一个
// `'shell'` 会让"过滤"在测试里永远自洽、真后端上永远过滤不出东西——正是 14 §10 那次事故的形状。
// `handlers.test.ts` 从外部把这条钉住。
//
// ⚠️ digest 用真 `sha256:` + 64 hex：模型层要认「空串 / `sha256:unresolved` ⇒ 未解析」，
// 替身给一个短哈希的话，"截断展示"这件事在 dev/Storybook 里根本看不出对错。
// ————————————————————————————————————————————————————————————————

const DIGEST_A = 'sha256:4b17e0c1f2a34b5c6d7e8f90112233445566778899aabbccddeeff0011223344';
const DIGEST_B = 'sha256:8e05a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d77';

function imageManifestDto(overrides: Partial<ImageManifestDto> = {}): ImageManifestDto {
  return {
    id: 'img-manifest-1',
    imageId: 'img-1',
    imageName: 'ghcr.io/agent-infra/sandbox',
    isBuiltin: true,
    ref: 'ghcr.io/agent-infra/sandbox:latest',
    version: 'latest',
    baseImage: 'ghcr.io/agent-infra/sandbox',
    digest: DIGEST_A,
    entrypointContract: { workdir: '/workspace', entrypoint: ['/bin/sh'] },
    supportedRuntimes: [RUNTIME_IDS.codex, RUNTIME_IDS.claudeCode],
    resourceDefaults: { cores: 2, ramMb: 4096, diskMb: 20480 },
    labelsRequired: [],
    // 04 §7 ★血统。默认工厂是**内置根镜像**（`isBuiltin: true`），它自己就是锚点 ⇒ `null`
    // （0012 记的语义 ①）。下面几条第三方夹具各自 override 成 `DIGEST_A`——那正是本条
    // 内置镜像的 digest，于是**替身内部的血统链是自洽可查的**，跟真后端的准入规则同形。
    // 纪律 ② 同款：替身里凭空写一个查无此人的锚点，"血统"在测试里永远自洽、真后端上永远拒绝。
    derivedFromDigest: null,
    validationStatus: 'valid',
    validationErrors: null,
    isActive: true,
    imageConfig: null,
    registeredAt: isoIn(-7 * DAY),
    resolvedAt: isoIn(-7 * DAY),
    ...overrides,
  };
}

/** 三行：预置 ✅ · 自定义 ⚠️（当前活行）· 同一张镜像的旧版本（已下线 ⇒ 历史里可回滚）。 */
const IMAGE_MANIFESTS: ImageManifestDto[] = [
  imageManifestDto(),
  /**
   * ⭐ `pending` 那一条 —— **它是为了让一条断言变得可证伪而加的**。
   *
   * 13 §2.4 的 `validation_status` 默认值就是 `pending`，而 P21-4 §5 的状态矩阵里
   * 没有它的呈现。可选性必须按**白名单**（valid|warning）放行，写成「≠ invalid」
   * 就会把它漏进向导下拉。
   *
   * ⚠️ 加它之前，`handlers.test.ts` 里那条「白名单放行」的断言是**守不住的**：
   * 夹具里根本没有 pending，把替身改成「≠ invalid」测试照样全绿。
   * 断言存在 ≠ 断言有效 —— 得先有能触发它的数据。
   */
  imageManifestDto({
    id: 'img-manifest-pending',
    derivedFromDigest: DIGEST_A,
    imageId: 'img-3',
    imageName: 'docker.io/myrepo/just-registered',
    isBuiltin: false,
    ref: 'docker.io/myrepo/just-registered:v1',
    version: 'v1',
    digest: `sha256:${'c'.repeat(64)}`,
    validationStatus: 'pending',
    validationErrors: [],
  }),
  imageManifestDto({
    id: 'img-manifest-2',
    derivedFromDigest: DIGEST_A,
    imageId: 'img-2',
    imageName: 'docker.io/myrepo/ml-agent',
    isBuiltin: false,
    ref: 'docker.io/myrepo/ml-agent:v1.0',
    version: 'v1.0',
    digest: DIGEST_B,
    supportedRuntimes: [RUNTIME_IDS.codex],
    validationStatus: 'warning',
    validationErrors: [
      {
        path: 'platform.supportedRuntimes',
        code: 'RUNTIME_NOT_PREINSTALLED',
        message: '未预装 claude-code，创建时需现装，实测约 12.5 分钟',
      },
    ],
    imageConfig: {
      env: [
        { key: 'LOG_LEVEL', value: 'info', secret: false },
        // 已存 secret 的 value 后端恒掩码成 ''（I-IMG-5），入站方向它的含义是「保持不变」。
        { key: 'MY_SECRET', value: '', secret: true },
      ],
    },
    registeredAt: isoIn(-3 * DAY),
    resolvedAt: isoIn(-3 * DAY),
  }),
  imageManifestDto({
    id: 'img-manifest-3',
    // ⚠️ 这条**刻意留 `null`**：它注册于 90 天前，是「切片前存量行」——0012 记的 NULL
    // 语义 ②。前端不许把 NULL 一律读成「内置根镜像」，而那条区分只有在夹具里**同时**
    // 存在 ① 和 ② 两种 NULL 时才可证伪（与上面 `pending` 那条同一手法）。
    derivedFromDigest: null,
    imageId: 'img-2',
    imageName: 'docker.io/myrepo/ml-agent',
    isBuiltin: false,
    ref: 'docker.io/myrepo/ml-agent:v1.0',
    version: 'v1.0',
    digest: DIGEST_A,
    supportedRuntimes: [RUNTIME_IDS.codex],
    isActive: false,
    registeredAt: isoIn(-90 * DAY),
    resolvedAt: isoIn(-90 * DAY),
  }),
];

const VALIDATION_OK: ValidationOutcomeDto = { status: 'valid', errors: [], warnings: [] };

export const handlers = [
  // liveness probe：真实契约 GET /api/health 无响应体 schema，getHealth 只读 response.ok/status。
  // 返回空 JSON（openapi-fetch 默认按 json 解析，须是合法 JSON），body 内容不被读取。
  http.get(`${API_BASE}/api/health`, () => HttpResponse.json({}, { status: 200 })),

  // 口令解锁（11 §3.1）：dev 无口令门，直接 204 成功（真实 cookie 由后端 set）。
  http.post(`${API_BASE}/api/access/unlock`, () => new HttpResponse(null, { status: 204 })),

  // 项目列表（10 §7 ProjectResponseDto）：dev 打通「项目树 → 建沙箱」。
  // ⏳ 基线四字段（repoUrl / repoBranch / baselineSizeBytes / updatedAt）是本轮契约新增、
  // 生成物尚未同步的部分（见 types/project.ts）——替身先按目标形状给，好让只读条与
  // 分支选择器在 dev/Storybook 里走得通；契约落地后这里一个字都不用改。
  http.get(`${API_BASE}/api/projects`, () =>
    HttpResponse.json(
      [
        projectDto({
          id: 'proj-demo',
          name: '示例项目',
          sourceType: 'git',
          cloneStatus: 'ready',
          repoUrl: 'https://github.com/acme/demo.git',
          repoBranch: 'main',
          baselineSizeBytes: 47_185_920,
          updatedAt: isoIn(-2 * HOUR),
        }),
      ],
      { status: 200 },
    ),
  ),

  /**
   * ⏳ 分支列表（F21-2 §N.1）：`GET /api/projects/:id/branches` → `string[]`。
   * **不触网、不需要凭证** —— 后端读的是完整克隆下来的**本地**引用（`git branch -r`）。
   */
  http.get(`${API_BASE}/api/projects/:id/branches`, () =>
    HttpResponse.json(['main', 'develop', 'feature/branch-picker']),
  ),

  /** ⏳ 重新同步基线（F21-6 §9.3）：仅 ready 态；dev 简化为 204。 */
  http.post(`${API_BASE}/api/projects/:id/sync`, () => new HttpResponse(null, { status: 204 })),

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

  // provider registry（GET /api/providers → ProviderResponseDto[]）：后端开放 registry 的只读投影。
  // ⚠️ 它**不再驱动一个「运行档位」单选**——那组单选已删（跑在哪种沙箱上是宿主平台的事实，
  // 不是用户偏好）。前端今天只从这份响应里取两样东西：`isDefault` 那一项的能力位
  // （`spawnTty` 决定终端入口），以及按沙箱 DTO 的 `provider` 反查该档位的 `headlessTask`。
  // 默认档由数组项的 isDefault 标记（无顶层字段）。
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

  // ——— 镜像（F21-4 §8.1）———
  //
  // `runtimeId` 缺席 ⇒ 管理页要的全量（含历史版本）；带上 ⇒ 向导可选集。
  //
  // ⚠️ **本替身此前实现的是另一条规则，2026-08 订正**，两处都错：
  //   ① `validationStatus !== 'invalid'` —— 而 `lib/image/selectableImages` 有一条专门的
  //      用例禁止这种写法：13 §2.4 的 `pending` 默认值会从这个口子漏进向导下拉。
  //   ② `supportedRuntimes.includes(runtimeId)` —— 那条规则已被真机实测否掉
  //      （只预装 codex 的平台镜像会让 claude-code 一张都选不到，见 selectableImages 文件头）。
  //
  // ⚠️ **替身与生产实现两条不同的规则，是最难发现的一种错**：集成测试全绿，而它验证的
  //   是替身的行为。
  //
  //   本想直接 import `lib/image/selectableImages` 复用，被 `boundaries` 挡了
  //   （`{ from: 'mock', allow: ['type','mock'] }`）——**而那条规则是对的，两条理由**：
  //   ① 本 handler 替的是**后端** `listSelectable`，不是前端那个客户端过滤，复用会把两件
  //      事混成一件；② 替身 import 生产代码之后就再也抓不出生产代码的 bug（它照抄了）。
  //   所以规则在这里重写一遍，由**测试**去钉住两处行为一致（handlers.test.ts）。
  http.get(`${API_BASE}/api/images`, ({ request }) => {
    const runtimeId = new URL(request.url).searchParams.get('runtimeId');
    if (runtimeId === null) return HttpResponse.json(IMAGE_MANIFESTS);
    return HttpResponse.json(
      // 白名单，不是「≠ invalid」：13 §2.4 的 pending 默认值不许漏进向导下拉。
      // runtime **不参与过滤**：血统保证了任何合规镜像都装得上任何 runtime，
      // 预装与否只决定选项旁那句「需现装约 12.5 分钟」（见 lib/image/selectableImages 文件头）。
      IMAGE_MANIFESTS.filter(
        (m) => m.isActive && (m.validationStatus === 'valid' || m.validationStatus === 'warning'),
      ),
    );
  }),

  // 注册前预检：**不落库**，所以这里也不往 IMAGE_MANIFESTS 里塞东西。
  http.post(`${API_BASE}/api/images/validate`, () => HttpResponse.json(VALIDATION_OK)),

  // 注册：dev 一律当成"新的一行"（201）。⚠️ 200 与 201 是两条不同的前端路径，
  // 需要 200 那条的用例自己 `server.use()` 覆盖——替身默认值不替它做决定。
  http.post(`${API_BASE}/api/images`, () => {
    const manifest = imageManifestDto({
      id: 'img-manifest-new',
      imageId: 'img-new',
      imageName: 'docker.io/myrepo/new-agent',
      isBuiltin: false,
      ref: 'docker.io/myrepo/new-agent:v2.0',
      version: 'v2.0',
      digest: DIGEST_B,
      supportedRuntimes: [RUNTIME_IDS.codex],
      registeredAt: isoIn(0),
      resolvedAt: isoIn(0),
    });
    const body: RegisterImageResponseDto = { manifest, validation: VALIDATION_OK };
    return HttpResponse.json(body, { status: 201 });
  }),

  // 重新验证：对**已钉定的 digest** 重跑校验；digest 没变 ⇒ 结论写回。
  http.post(`${API_BASE}/api/images/:id/validate`, () => {
    const body: RevalidateOutcomeDto = {
      ...VALIDATION_OK,
      currentDigest: DIGEST_A,
      upstreamDigest: DIGEST_A,
      digestChanged: false,
    };
    return HttpResponse.json(body);
  }),

  // 检查更新：dev 给"已是最新"（changed:false）。要对比弹层的用例自己覆盖。
  http.post(`${API_BASE}/api/images/:id/check-update`, ({ params }) => {
    const id = String(params['id']);
    const current = IMAGE_MANIFESTS.find((m) => m.id === id) ?? IMAGE_MANIFESTS[0];
    const digest = current?.digest ?? DIGEST_A;
    const body: CheckImageUpdateDto = {
      current: { digest, resolvedAt: current?.resolvedAt ?? isoIn(-3 * DAY) },
      upstream: { digest, validation: VALIDATION_OK },
      changed: false,
    };
    return HttpResponse.json(body);
  }),

  // 切换版本（「更新到新版本」与「回滚到旧版本」同一个动作）。
  http.post(`${API_BASE}/api/images/:id/activate`, ({ params }) => {
    const id = String(params['id']);
    const row = IMAGE_MANIFESTS.find((m) => m.id === id) ?? IMAGE_MANIFESTS[0];
    return HttpResponse.json(imageManifestDto({ ...row, id, isActive: true }));
  }),

  // 两个可变字段的唯一入口。⚠️ `isActive:true` 后端**回 400 并指向 /activate**，
  // 替身照做——否则前端写出一个真后端上必然 400 的调用，而测试全绿。
  http.patch(`${API_BASE}/api/images/:id`, async ({ params, request }) => {
    const id = String(params['id']);
    const body: unknown = await request.json();
    const row = IMAGE_MANIFESTS.find((m) => m.id === id) ?? IMAGE_MANIFESTS[0];
    const isActive =
      typeof body === 'object' && body !== null && 'isActive' in body
        ? Reflect.get(body, 'isActive')
        : undefined;
    if (isActive === true) {
      return HttpResponse.json(
        {
          code: 'BAD_REQUEST',
          message: '启用请改用 POST /api/images/:id/activate',
          retryable: false,
          sideEffectFree: true,
        },
        { status: 400 },
      );
    }
    return HttpResponse.json(
      imageManifestDto({ ...row, id, ...(isActive === false ? { isActive: false } : {}) }),
    );
  }),

  http.delete(`${API_BASE}/api/images/:id`, () => new HttpResponse(null, { status: 204 })),
];
