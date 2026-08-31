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
import type { RetainedVolumeDto } from '@/types/retainedVolume';
import type { AutomationDto, AutomationRunDto } from '@/types/automation';
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
import type { AuditEventDto, AuditListDto } from '@/types/audit';
import { SSE_DIAGNOSE_SCHEMA_HASH } from '@/types/sse-protocol';
import type { DiagnoseServerFrame } from '@/types/sse-protocol';
import type {
  InitStatusDto,
  SystemProvidersDto,
  SystemResourcesDto,
  SystemSettingsDto,
} from '@/types/system';

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

const MB = 1024 * 1024;

/**
 * 生成一条 RetainedVolumeDto（10 §7.3）。
 *
 * ⚠️ **两个大小刻意给成一个数量级之外的差**（实测本仓 web 工作区：磁盘 1.0 GB / tar 14 MB，
 * 差 70 倍；数字在 10 §6「保留卷的打包口径」表里，⚠️ 那里写的出处 03 §7.7 并没有这组数）。dev/Storybook 里如果这两个数只差一点点，"只显示一个就够了"这个
 * 错误决定在替身上**看不出任何问题**——而那正是这个界面最容易犯的错（10 §6 打包口径）。
 */
function retainedVolumeDto(
  overrides: Partial<RetainedVolumeDto> & Pick<RetainedVolumeDto, 'id'>,
): RetainedVolumeDto {
  return {
    projectId: 'proj-demo',
    sandboxId: 'sbx-demo',
    source: 'manual-destroy',
    retainedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    retainUntil: new Date(Date.now() + 27 * 24 * 3600 * 1000).toISOString(),
    diskBytes: 1024 * MB,
    downloadBytes: 14 * MB,
    ...overrides,
  };
}

/**
 * 一条自动化规则替身（10 §7.3 `AutomationDto` 逐字段抄写；12 §3.4：形状可以手写，值不能凭空）。
 *
 * ⚠️ `runtime` 从注册表常量取，不写字面量 —— 14 §10 那个 `runtime: 'shell'` 的坑同一处封堵。
 * ⚠️ `timezone` 刻意给 `Asia/Shanghai` 这个**固定值**，而不是 `resolvedOptions().timeZone`：
 *    替身若跟着本机时区走，「规则用的是快照时区、不是你的时区」这条语义在 dev/Storybook 里
 *    就永远看不出差别，而那正是这一页最容易做错的地方（23 I-AUT-9）。
 */
function automationDto(
  overrides: Partial<AutomationDto> & Pick<AutomationDto, 'id'>,
): AutomationDto {
  return {
    projectId: 'proj-demo',
    name: '每天凌晨数据分析',
    runtime: RUNTIME_IDS.codex,
    prompt: '汇总昨天的错误日志，输出一份 markdown 报告到 reports/。',
    scheduleKind: 'daily',
    scheduleConfig: { time: '08:00' },
    timezone: 'Asia/Shanghai',
    timeoutMinutes: 120,
    artifactRetentionDays: 7,
    enabled: true,
    degraded: false,
    consecutiveFailures: 0,
    triggerOn: 'failure',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    nextTriggerAt: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
    ...overrides,
  };
}

/** 一条运行历史替身（10 §7.3 `AutomationRunDto` + 两处契约缺口字段，见 types/automation 文件头）。 */
function automationRunDto(
  overrides: Partial<AutomationRunDto> & Pick<AutomationRunDto, 'id'>,
): AutomationRunDto {
  return {
    automationId: 'auto-1',
    status: 'success',
    retryCount: 0,
    triggeredAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    startedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    durationMs: 72_000,
    ...overrides,
  };
}

/**
 * dev 的规则集合：**八个 status 里能在列表上看见的四种规则态各一条**。
 * 少了 🟡/🔴 两条，"降频"与"自动禁用"在 dev 下永远看不到，而它们正是这一页最复杂的分支。
 */
const AUTOMATION_FIXTURES: AutomationDto[] = [
  automationDto({ id: 'auto-1' }),
  automationDto({
    id: 'auto-2',
    name: '每周一日志备份',
    scheduleKind: 'weekly',
    scheduleConfig: { time: '03:00', days: [1] },
    runtime: RUNTIME_IDS.claudeCode,
  }),
  automationDto({
    id: 'auto-3',
    name: '每小时内存检查',
    scheduleKind: 'hourly',
    scheduleConfig: { minute: 0 },
    enabled: false,
    nextTriggerAt: undefined,
  }),
  automationDto({
    id: 'auto-4',
    name: '每日报表',
    degraded: true,
    consecutiveFailures: 4,
  }),
  automationDto({
    id: 'auto-5',
    name: '夜间回归',
    enabled: false,
    degraded: true,
    consecutiveFailures: 11,
    nextTriggerAt: undefined,
  }),
];

/**
 * dev 的运行历史：**八个 status 全部出现至少一次**。
 * ⚠️ 这不是凑数 —— 这一页界面的全部难点就是"让用户分清 failed / skipped / missed /
 *    resource-exhausted 是四件不同的事"，替身里少哪一个，对应的分支在 dev 下就没人看过。
 */
const AUTOMATION_RUN_FIXTURES: AutomationRunDto[] = [
  automationRunDto({
    id: 'run-1',
    status: 'success',
    sandboxId: 'sbx-demo',
    webhookStatus: 'skipped',
  }),
  automationRunDto({
    id: 'run-2',
    status: 'failed',
    durationMs: 15_000,
    outputSummary: 'Error: ENOENT reports/\n  at writeReport (index.ts:42)',
    sandboxId: 'sbx-demo',
    webhookStatus: 'sent',
  }),
  automationRunDto({
    id: 'run-3',
    status: 'timeout',
    durationMs: 7_200_000,
    sandboxId: 'sbx-demo',
  }),
  automationRunDto({ id: 'run-4', status: 'skipped', errorCode: 'AUTH_EXPIRED' }),
  automationRunDto({ id: 'run-5', status: 'skipped', errorCode: 'PREVIOUS_RUNNING' }),
  automationRunDto({ id: 'run-6', status: 'missed' }),
  automationRunDto({
    id: 'run-7',
    status: 'resource-exhausted',
    retryCount: 3,
    retryAt: new Date(Date.now() + 24 * 60 * 1000).toISOString(),
  }),
  automationRunDto({ id: 'run-8', status: 'running', durationMs: undefined }),
  automationRunDto({ id: 'run-9', status: 'pending', durationMs: undefined }),
];

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

// ————————————————————————————————————————————————————————————————
// 审计流替身数据（13 §2.8.2 的 `audit_events` 行形状；**恒按 seq 降序**）。
//
// ★ 形状与取值逐条对齐**后端实写的写入点**（12 §3.4「替身的值不能凭空」）：
//   · 写入口 ①（`api/apps/api/src/platform/audit/audit.projector.ts`）——
//     `sandbox.created` / `sandbox.state_changed` / `project.created` / `credential.stored`
//     / `sandbox.runtime_install` / `credential.injected` / `sandbox.task.*`
//   · 写入口 ②（`provision-sandbox.workflow.ts` / `runtime-install.orchestrator.ts`）——
//     `sandbox.provision.stage` / `sandbox.workspace.prepared` / `sandbox.agent_session`
//     / `sandbox.probe` / `sandbox.credential.absent`
//   · 写入口 ③（2026-08-28 后端补齐的审计覆盖缺口）——
//     `project.clone_retried` / `project.converted_to_empty` / `project.clone_cancelled`
//     / `project.baseline_synced` / `project.deleted`；`credential.auth_mode_changed`；
//     **镜像整档** `image.registered|validated|activated|deactivated|config_updated|deleted`；
//     **系统整档** `system.access.unlocked|unlock_failed|locked|locked_attempt`。
//     ⇒ 五个契约类别至此**全部有生产者**，`AUDIT_CATEGORY_EMIT_STATUS` 随之全标 `emitted`
//       （`handlers.test.ts` 那条双向对账守卫就是这么响的：替身先补形状，表没跟上就红）。
//   · ⏳ `sandbox.health` 后端**仍未落地**，所以这里**一条都不喂**——替身里凭空造一个
//     后端不产出的 type，正是本文件抬头那条纪律要禁的（`'shell'` 事故同形）。
//
// ⚠️ 这份替身此前与真实后端**几乎不相交**，而三处都属于"dev/story/测试全绿、真实界面不一样"：
//   ① `category` 只喂 `sandbox` + `image`（且那时后端**从不写** `image`）⇒ 「类别=镜像」
//      在 dev 里有数据、真实环境永远为空。今天反过来：后端真写了，替身必须真有。
//   ② `type` 只有 `sandbox.provision.stage` 与一个后端根本不产出的 `image.validation.warning`。
//   ③ **每一行都恒有 `durationMs` + `outcome` + `subjectType:'sandbox'`** ⇒ 真实的
//      `project.created` / `credential.stored` 那几列全是空的、也没有 [查看该沙箱完整时间线]，
//      行密度与所有 story / 测试都对不上；而「无 detail 的行不给展开箭头」这条纪律
//      在替身下几乎没被触发过（这里的 `project.created` / `credential.stored` 就是它的现场）。
//      ★ `system.*` 更进一步：它**连 `subjectType`/`subjectId` 都没有**（主体就是平台自己），
//        是「非沙箱行没有时间线入口」那条纪律在替身里第一个"连主体都没有"的现场。
//   ④ `actor` 清一色 `system`，**最高频的 `scheduler` 一次都没喂过**（后端写入点里
//      provision/runtime-install 那批写 `scheduler`）。`AUDIT_ACTORS = TRIGGERED_BY ∪ {'system'}`
//      六个值这里全覆盖。⑤ 新补的管理动作（镜像/系统/项目）后端一律写 `user`。
//
// `at` 是**毫秒精度**（本仓第一处），故这里刻意给出同一秒内的多条。
// ————————————————————————————————————————————————————————————————

/** `SandboxStateChanged.triggeredBy` 原样透传成 actor（后端 `transitionActor()`）。 */
const TRANSITION_ACTORS = ['health-check', 'provider-event', 'reaper'] as const;

/** 一条事件的"形状"。 */
type AuditShape = (seq: number, at: string, sandboxId: string) => AuditEventDto;

/**
 * 形状 + 它在流里占几个轮转槽位。
 *
 * ⚠️ **权重不是装饰，是"哪种事件在刷屏"这件事本身**：真实审计流里 provision / 探测 /
 * runtime 安装是每建一个沙箱就刷十几条的，而"注册一张镜像""改一次口令""删一个项目"
 * 是稀疏的管理动作。此前用的是"一形状一槽位"的等权轮转——补进镜像/系统/项目那 15 个
 * 管理形状之后，等权会让 `user` 一举盖过 `scheduler`，替身的行密度与真实流当场对不上
 * （`handlers.test.ts` 那条「scheduler 是最高频的那个」正是钉这件事的）。
 * ⛔ 所以不许靠"多复制几行 shape"来配权重——那是把权重藏进重复代码里。
 */
interface AuditShapeSpec {
  /** 占几个槽位。3 = 刷屏的调度器动作；1 = 稀疏的管理动作。 */
  readonly weight: number;
  readonly make: AuditShape;
}

/** 调度器批：真实流里的绝对多数。 */
const SCHEDULER_WEIGHT = 3;

/**
 * 镜像事件的主体：**必须是这份替身自己 `GET /api/images` 里真有的那张清单**（本文件纪律 ②）。
 *
 * ⚠️ `subjectId` 是 manifestId、`summary` 里才是完整 `ref`（registry/repo:tag）——两者
 * 不是一回事。把 ref 写进 subjectId 的那一版，"按对象筛"在真后端上永远筛不到东西，
 * 而 dev 里看着完全正常。这里查不到就当场抛，凭空的 id 进不来。
 */
function imageSubject(manifestId: string): { subjectId: string; ref: string } {
  const manifest = IMAGE_MANIFESTS.find((m) => m.id === manifestId);
  if (manifest === undefined) {
    throw new Error(`审计替身引用了不存在的镜像清单：${manifestId}`);
  }
  return { subjectId: manifest.id, ref: manifest.ref };
}

const AUDIT_SHAPES: readonly AuditShapeSpec[] = [
  // ——— 写入口 ②：provision workflow / runtime-install，全部 actor: 'scheduler' ———
  {
    weight: SCHEDULER_WEIGHT,
    make: (seq, at, sandboxId) => ({
      seq,
      at,
      category: 'sandbox',
      type: 'sandbox.provision.stage',
      severity: 'info',
      subjectType: 'sandbox',
      subjectId: sandboxId,
      actor: 'scheduler',
      summary: 'provision 阶段「prepare-workspace」完成',
      detail: { stage: 'prepare-workspace' },
      durationMs: 1000 + (seq % 37) * 91,
      outcome: 'ok',
    }),
  },
  {
    weight: SCHEDULER_WEIGHT,
    make: (seq, at, sandboxId) => ({
      seq,
      at,
      category: 'sandbox',
      type: 'sandbox.provision.stage',
      severity: 'error',
      subjectType: 'sandbox',
      subjectId: sandboxId,
      actor: 'scheduler',
      summary: 'provision 阶段「create」失败',
      detail: { stage: 'create', message: `provider ${PROVIDER_NAMES.aio} 无可用容量` },
      durationMs: 4231,
      outcome: 'failed',
      errorCode: 'PROVIDER_UNAVAILABLE',
    }),
  },
  {
    weight: SCHEDULER_WEIGHT,
    make: (seq, at, sandboxId) => ({
      seq,
      at,
      category: 'sandbox',
      type: 'sandbox.workspace.prepared',
      // baseline 读不到时后端是**静默降级成空工作区**的，所以这条是 warn 而不是 info。
      severity: 'warn',
      subjectType: 'sandbox',
      subjectId: sandboxId,
      actor: 'scheduler',
      summary: '工作区就绪，但源 baseline 读不到 —— 工作区是空的',
      detail: { baselineExisted: false, entryCount: 0, hostPath: `/var/lib/ap/ws/${sandboxId}` },
      outcome: 'ok',
    }),
  },
  {
    weight: SCHEDULER_WEIGHT,
    make: (seq, at, sandboxId) => ({
      seq,
      at,
      category: 'sandbox',
      type: 'sandbox.workspace.prepared',
      severity: 'info',
      subjectType: 'sandbox',
      subjectId: sandboxId,
      actor: 'scheduler',
      summary: `工作区就绪，${String((seq % 9) + 1)} 个顶层条目`,
      detail: {
        baselineExisted: true,
        entryCount: (seq % 9) + 1,
        hostPath: `/var/lib/ap/ws/${sandboxId}`,
      },
      outcome: 'ok',
    }),
  },
  {
    weight: SCHEDULER_WEIGHT,
    make: (seq, at, sandboxId) => ({
      seq,
      at,
      category: 'sandbox',
      type: 'sandbox.probe',
      severity: 'info',
      subjectType: 'sandbox',
      subjectId: sandboxId,
      actor: 'scheduler',
      summary: `探测 ${DEFAULT_RUNTIME_ID}：exit 0`,
      detail: {
        runtimeId: DEFAULT_RUNTIME_ID,
        argv: [DEFAULT_RUNTIME_ID, '--version'],
        exitCode: 0,
        stdoutTail: 'codex 0.42.1',
        stderrTail: '',
      },
      durationMs: 120 + (seq % 11) * 7,
      outcome: 'ok',
    }),
  },
  {
    weight: SCHEDULER_WEIGHT,
    make: (seq, at, sandboxId) => ({
      seq,
      at,
      category: 'sandbox',
      type: 'sandbox.probe',
      // 「探测说没装」是 warn；「探测炸了」才是 error（后端把这两件事分开记）。
      severity: 'warn',
      subjectType: 'sandbox',
      subjectId: sandboxId,
      actor: 'scheduler',
      summary: `探测 ${RUNTIME_IDS.claudeCode}：exit 127`,
      detail: {
        runtimeId: RUNTIME_IDS.claudeCode,
        argv: [RUNTIME_IDS.claudeCode, '--version'],
        exitCode: 127,
        stdoutTail: '',
        stderrTail: 'command not found',
      },
      durationMs: 90,
      outcome: 'failed',
    }),
  },
  {
    weight: SCHEDULER_WEIGHT,
    make: (seq, at, sandboxId) => ({
      seq,
      at,
      category: 'sandbox',
      type: 'sandbox.agent_session',
      severity: 'info',
      subjectType: 'sandbox',
      subjectId: sandboxId,
      actor: 'scheduler',
      summary: `已启动 ${DEFAULT_RUNTIME_ID} agent 会话`,
      detail: {
        runtimeId: DEFAULT_RUNTIME_ID,
        started: true,
        reusedExisting: false,
        promptCarried: true,
      },
      durationMs: 2000 + (seq % 23) * 61,
      outcome: 'ok',
    }),
  },
  {
    weight: SCHEDULER_WEIGHT,
    make: (seq, at, sandboxId) => ({
      seq,
      at,
      category: 'sandbox',
      type: 'sandbox.credential.absent',
      severity: 'warn',
      subjectType: 'sandbox',
      subjectId: sandboxId,
      actor: 'scheduler',
      summary: `没有可用的 ${DEFAULT_RUNTIME_ID} 凭证，agent 将以未登录状态启动`,
      detail: { runtimeId: DEFAULT_RUNTIME_ID },
      outcome: 'skipped',
      errorCode: 'CREDENTIAL_NOT_FOUND',
    }),
  },
  // ——— 写入口 ①：projector（actor 来自领域事件） ———
  // ⚠️ 权重 3 不是"让它多一点"：三个槽位是相邻下标，而 `seq % 3` 在这三个下标上恰好取遍
  //    0/1/2 ⇒ `triggeredBy` 那三个 actor 一个不落。压成 1 的话会只剩一个 actor 出现，
  //    而「六个 actor 全覆盖」那条断言就会红——那正是它该红的时候。
  {
    weight: 3,
    make: (seq, at, sandboxId) => ({
      seq,
      at,
      category: 'sandbox',
      type: 'sandbox.state_changed',
      severity: 'info',
      subjectType: 'sandbox',
      subjectId: sandboxId,
      // `triggeredBy` **原样透传**：这三个值只会从这条路径进来。
      actor: TRANSITION_ACTORS[seq % TRANSITION_ACTORS.length] ?? 'reaper',
      summary: '沙箱状态 running → stopped',
      detail: { from: 'running', to: 'stopped' },
      outcome: 'ok',
    }),
  },
  {
    weight: 2,
    make: (seq, at, sandboxId) => ({
      seq,
      at,
      category: 'sandbox',
      type: 'sandbox.created',
      severity: 'info',
      subjectType: 'sandbox',
      subjectId: sandboxId,
      actor: 'user',
      summary: `创建沙箱 ${sandboxId}`,
      detail: { projectId: 'proj-demo' },
    }),
  },
  {
    weight: 2,
    make: (seq, at, sandboxId) => ({
      seq,
      at,
      category: 'sandbox',
      type: 'sandbox.runtime_install',
      severity: 'info',
      subjectType: 'sandbox',
      subjectId: sandboxId,
      actor: 'system',
      summary: `${DEFAULT_RUNTIME_ID} 安装状态：installed`,
      detail: { runtimeId: DEFAULT_RUNTIME_ID, status: 'installed', versionDetected: '0.42.1' },
    }),
  },
  // ⚠️ 下面两条是**这份替身里最重要的两行**：后端的 `project.created` / `credential.stored`
  // 就是这个形状 —— **没有 `durationMs`、没有 `outcome`、没有 `detail`**，subjectType 也不是
  // `sandbox`。于是它们在界面上：那几列是空的、没有 [查看该沙箱完整时间线]、**不给展开箭头**。
  // 此前替身里一行这样的都没有，「无 detail 的行不给展开箭头」这条纪律几乎没被触发过。
  {
    weight: 1,
    make: (seq, at) => ({
      seq,
      at,
      category: 'project',
      type: 'project.created',
      severity: 'info',
      subjectType: 'project',
      subjectId: `proj-${String((seq % 3) + 1)}`,
      actor: 'user',
      summary: `创建项目 proj-${String((seq % 3) + 1)}`,
    }),
  },
  {
    weight: 1,
    make: (seq, at) => ({
      seq,
      at,
      category: 'credential',
      type: 'credential.stored',
      severity: 'info',
      subjectType: 'credential',
      subjectId: `cred-${String((seq % 4) + 1)}`,
      actor: 'user',
      summary: `保存凭证 cred-${String((seq % 4) + 1)}`,
    }),
  },
  // ——— 写入口 ③ · 项目档的新增 type（后端 2026-08-28 补齐） ———
  {
    weight: 1,
    make: (seq, at) => ({
      seq,
      at,
      category: 'project',
      type: 'project.clone_retried',
      severity: 'info',
      subjectType: 'project',
      subjectId: `proj-${String((seq % 3) + 1)}`,
      actor: 'user',
      summary: `重试克隆 proj-${String((seq % 3) + 1)}（第 2 次）`,
      detail: { attempt: 2, previousErrorCode: 'CLONE_FAILED_NETWORK' },
      durationMs: 12_400,
      outcome: 'ok',
    }),
  },
  {
    weight: 1,
    make: (seq, at) => ({
      seq,
      at,
      category: 'project',
      type: 'project.converted_to_empty',
      // 克隆最终没成、项目被降级成空项目 —— 用户拿到的东西与他要的不一样，是 warn。
      severity: 'warn',
      subjectType: 'project',
      subjectId: `proj-${String((seq % 3) + 1)}`,
      actor: 'user',
      summary: `克隆放弃，proj-${String((seq % 3) + 1)} 已转为空项目`,
      // ⚠️ detail **只有 host，没有完整 repoUrl**：URL 里可能带 `user:token@`，
      //    审计是长期留存的，整条 URL 落进去等于把凭证写进了一张谁都能导出的表。
      detail: { discardedRepoHost: 'github.com' },
      outcome: 'ok',
    }),
  },
  {
    weight: 1,
    make: (seq, at) => ({
      seq,
      at,
      category: 'project',
      type: 'project.clone_cancelled',
      severity: 'warn',
      subjectType: 'project',
      subjectId: `proj-${String((seq % 3) + 1)}`,
      actor: 'user',
      summary: `用户取消了 proj-${String((seq % 3) + 1)} 的克隆`,
      // `skipped` ≠ `failed`：没做完，但不是出错。界面上这两个不许混成一个"❌"。
      outcome: 'skipped',
    }),
  },
  {
    weight: 1,
    make: (seq, at) => ({
      seq,
      at,
      category: 'project',
      type: 'project.baseline_synced',
      severity: 'info',
      subjectType: 'project',
      subjectId: `proj-${String((seq % 3) + 1)}`,
      actor: 'user',
      summary: '基线已同步至 origin/main',
      detail: { branch: 'main', entryCount: (seq % 7) + 3 },
      durationMs: 3000 + (seq % 13) * 121,
      outcome: 'ok',
    }),
  },
  {
    weight: 1,
    make: (seq, at) => ({
      seq,
      at,
      category: 'project',
      type: 'project.deleted',
      // 删除是不可逆的，恒 warn（哪怕成功）。
      severity: 'warn',
      subjectType: 'project',
      subjectId: `proj-${String((seq % 3) + 1)}`,
      actor: 'user',
      // ⚠️ `keptBaseline` 是这条**唯一**能回答"磁盘上还剩没剩东西"的地方：删项目时
      //    留不留基线是用户的选择，事后只有这一条记着。压进 summary 就再也筛不出来。
      summary: `删除项目 proj-${String((seq % 3) + 1)}`,
      detail: { keptBaseline: seq % 2 === 0 },
      outcome: 'ok',
    }),
  },
  // ——— 写入口 ③ · 凭证档的新增 type ———
  {
    weight: 1,
    make: (seq, at) => ({
      seq,
      at,
      category: 'credential',
      type: 'credential.auth_mode_changed',
      severity: 'info',
      // ⚠️ 主体是 **runtime**，不是 credential：subjectId 是 `claude-code` 这样的 runtimeId。
      //    「凭证类事件的 subjectId 一定是 cred-*」这种简写在这条上当场破功。
      subjectType: 'runtime',
      subjectId: RUNTIME_IDS.claudeCode,
      actor: 'user',
      summary: `${RUNTIME_IDS.claudeCode} 认证方式：api-key → oauth-device`,
      detail: { runtimeId: RUNTIME_IDS.claudeCode, from: 'api-key', to: 'oauth-device' },
      outcome: 'ok',
    }),
  },
  // ——— 写入口 ③ · 镜像整档（此前零生产者） ———
  // subjectType 恒 `image`、subjectId 是 manifestId，**summary 里才是完整 ref**。
  {
    weight: 1,
    make: (seq, at) => {
      const { subjectId, ref } = imageSubject('img-manifest-pending');
      return {
        seq,
        at,
        category: 'image',
        type: 'image.registered',
        severity: 'info',
        subjectType: 'image',
        subjectId,
        actor: 'user',
        summary: `注册镜像 ${ref}`,
        detail: { ref, resolvedDigest: `sha256:${'c'.repeat(64)}` },
        durationMs: 2400,
        outcome: 'ok',
      };
    },
  },
  {
    weight: 1,
    make: (seq, at) => {
      const { subjectId, ref } = imageSubject('img-manifest-2');
      return {
        seq,
        at,
        category: 'image',
        type: 'image.validated',
        severity: 'info',
        subjectType: 'image',
        subjectId,
        actor: 'user',
        summary: `校验镜像 ${ref}：warning（1 条）`,
        detail: { status: 'warning', errorCount: 0, warningCount: 1, digestChanged: false },
        durationMs: 8600,
        outcome: 'ok',
      };
    },
  },
  {
    weight: 1,
    make: (seq, at) => {
      const { subjectId, ref } = imageSubject('img-manifest-2');
      return {
        seq,
        at,
        category: 'image',
        type: 'image.activated',
        severity: 'info',
        subjectType: 'image',
        subjectId,
        actor: 'user',
        summary: `启用镜像 ${ref}`,
        detail: { replacedManifestId: 'img-manifest-3' },
        outcome: 'ok',
      };
    },
  },
  {
    weight: 1,
    make: (seq, at) => {
      const { subjectId, ref } = imageSubject('img-manifest-3');
      return {
        seq,
        at,
        category: 'image',
        type: 'image.deactivated',
        // 下线意味着"新建沙箱不会再用它"，是个会让人意外的状态变化 ⇒ warn。
        severity: 'warn',
        subjectType: 'image',
        subjectId,
        actor: 'user',
        summary: `下线镜像 ${ref}`,
        detail: { reason: 'replaced-by-newer-manifest' },
        outcome: 'ok',
      };
    },
  },
  {
    weight: 1,
    make: (seq, at) => {
      const { subjectId, ref } = imageSubject('img-manifest-2');
      return {
        seq,
        at,
        category: 'image',
        type: 'image.config_updated',
        severity: 'info',
        subjectType: 'image',
        subjectId,
        actor: 'user',
        // ⛔ **这条刻意没有 `detail`**（04 §2.3★）：镜像 env 会被物化成 `export K=V` 拼进
        //    命令串，把它的任何投影写进审计，等于把用户填的密钥永久留在一张可导出的表里。
        //    界面上这行因此**没有展开箭头** —— 那是对的，不是漏了。
        summary: `更新镜像配置 ${ref}`,
        outcome: 'ok',
      };
    },
  },
  {
    weight: 1,
    make: (seq, at) => {
      const { subjectId, ref } = imageSubject('img-manifest-3');
      return {
        seq,
        at,
        category: 'image',
        type: 'image.deleted',
        severity: 'warn',
        subjectType: 'image',
        subjectId,
        actor: 'user',
        summary: `删除镜像 ${ref}`,
        detail: { ref },
        outcome: 'ok',
      };
    },
  },
  // ——— 写入口 ③ · 系统整档（此前零生产者） ———
  // ★ 这四条**没有 `subjectType` / `subjectId`**：主体就是平台自己。
  //   于是界面上它们既没有 [查看该沙箱完整时间线]，"对象"列也是空的——
  //   「非沙箱行没有时间线入口」那条纪律在这里是"连主体都没有"的极端形态。
  // ⛔ detail 里只有计数，**绝无口令的任何投影**（长度、前缀、哈希都不行）。
  {
    weight: 1,
    make: (seq, at) => ({
      seq,
      at,
      category: 'system',
      type: 'system.access.unlocked',
      severity: 'info',
      actor: 'user',
      summary: '口令校验通过，已解锁',
      outcome: 'ok',
    }),
  },
  {
    weight: 1,
    make: (seq, at) => ({
      seq,
      at,
      category: 'system',
      type: 'system.access.unlock_failed',
      severity: 'warn',
      actor: 'user',
      summary: '口令错误（第 2 次，共 5 次机会）',
      detail: { consecutiveFailures: 2, maxFailures: 5 },
      outcome: 'failed',
      errorCode: 'PASSCODE_INVALID',
    }),
  },
  {
    weight: 1,
    make: (seq, at) => ({
      seq,
      at,
      category: 'system',
      type: 'system.access.locked',
      // ★ 替身里为数不多的 `error` 级样本之一，而且是**非沙箱**的那种：
      //   此前 error 只出在 `sandbox.provision.stage` 上，"error 行长什么样"
      //   几乎只被那一个形状验证过。
      severity: 'error',
      actor: 'user',
      summary: '连续 5 次口令错误，已锁定 15 分钟',
      detail: { consecutiveFailures: 5, maxFailures: 5, lockedForSec: 900 },
      outcome: 'failed',
      errorCode: 'PASSCODE_LOCKED',
    }),
  },
  {
    weight: 1,
    make: (seq, at) => ({
      seq,
      at,
      category: 'system',
      type: 'system.access.locked_attempt',
      severity: 'warn',
      actor: 'user',
      summary: '锁定期间又试了一次，未校验',
      // 锁定期内的尝试**根本没走校验** ⇒ `skipped`，不是 `failed`。
      detail: { lockedForSec: 812 },
      outcome: 'skipped',
      errorCode: 'PASSCODE_LOCKED',
    }),
  },
];

/** 权重展开成槽位表：下标 = `seq % 槽位数`。 */
const AUDIT_SHAPE_SLOTS: readonly AuditShape[] = AUDIT_SHAPES.flatMap(({ weight, make }) =>
  Array.from({ length: weight }, () => make),
);

function auditEvent(seq: number): AuditEventDto {
  const at = new Date(Date.now() - (300 - seq) * 1237).toISOString();
  const sandboxId = `sb-${String((seq % 5) + 1)}`;
  const shape = AUDIT_SHAPE_SLOTS[seq % AUDIT_SHAPE_SLOTS.length];
  if (shape === undefined) throw new Error('AUDIT_SHAPES 不能为空');
  return shape(seq, at, sandboxId);
}

const AUDIT_EVENTS: AuditEventDto[] = Array.from({ length: 300 }, (_, i) => auditEvent(300 - i));

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

  // —— 保留卷（F21-6 §3.3 / 10 §7.3；三端点统一在 `/api/retained-volumes` 前缀下，审计 P2-5）——
  // ⚠️ 后端这条切片正在并行实现，openapi.json 里还没有它们 ⇒ 这里是**手写形状**，
  //    依据是 10 §7.3 的 `RetainedVolumeDto` 逐字段抄写（12 §3.4：形状可以手写，值不能凭空）。
  http.get(`${API_BASE}/api/retained-volumes`, ({ request }) => {
    const projectId = new URL(request.url).searchParams.get('projectId') ?? 'proj-demo';
    return HttpResponse.json([
      retainedVolumeDto({ id: 'rv-1', projectId }),
      retainedVolumeDto({
        id: 'rv-2',
        projectId,
        // 弱引用断掉的那条：sandbox 记录已归档，卷仍可管理（10 §7.3）。
        sandboxId: undefined,
        source: 'automation-artifact',
        retainUntil: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
        diskBytes: 320 * MB,
        downloadBytes: 3 * MB,
      }),
    ]);
  }),
  http.delete(
    `${API_BASE}/api/retained-volumes/:id`,
    () => new HttpResponse(null, { status: 204 }),
  ),
  // tar 流：dev 下给一段占位字节 + 精确 Content-Length（浏览器进度条靠的就是它，10 §6）。
  http.get(`${API_BASE}/api/retained-volumes/:id/archive`, ({ params }) => {
    const body = new Uint8Array(1024);
    return new HttpResponse(body, {
      headers: {
        'content-type': 'application/x-tar',
        'content-length': String(body.byteLength),
        'content-disposition': `attachment; filename="${String(params['id'])}.tar"`,
      },
    });
  }),

  // —— 自动化（F21-7 / 10 §6.5 的 7 条 + webhook-test）——
  // ⚠️ 后端这条切片正在并行实现，openapi.json 里还没有它们 ⇒ **手写形状**，
  //    依据是 10 §7.3 的 automation 契约块逐字段抄写（12 §3.4）。
  http.get(`${API_BASE}/api/projects/:id/automations`, ({ params }) =>
    HttpResponse.json(
      AUTOMATION_FIXTURES.map((rule) => ({ ...rule, projectId: String(params['id']) })),
    ),
  ),
  http.post(`${API_BASE}/api/projects/:id/automations`, async ({ params, request }) => {
    const body: unknown = await request.json().catch(() => ({}));
    return HttpResponse.json(
      automationDto({
        id: `auto-${String(Date.now())}`,
        projectId: String(params['id']),
        ...(typeof body === 'object' && body !== null ? (body as Partial<AutomationDto>) : {}),
      }),
      { status: 201 },
    );
  }),
  http.put(`${API_BASE}/api/automations/:id`, async ({ params, request }) => {
    const body: unknown = await request.json().catch(() => ({}));
    return HttpResponse.json(
      automationDto({
        id: String(params['id']),
        ...(typeof body === 'object' && body !== null ? (body as Partial<AutomationDto>) : {}),
      }),
    );
  }),
  http.delete(`${API_BASE}/api/automations/:id`, () => new HttpResponse(null, { status: 204 })),
  http.post(`${API_BASE}/api/automations/:id/enable`, ({ params }) =>
    // enable 同时清零失败计数并解降频（03 §8.4）——替身也照做，
    // 否则前端的乐观更新与"真"响应对不上，而对不上的那一版才是错的。
    HttpResponse.json(
      automationDto({
        id: String(params['id']),
        enabled: true,
        degraded: false,
        consecutiveFailures: 0,
      }),
    ),
  ),
  http.post(`${API_BASE}/api/automations/:id/disable`, ({ params }) =>
    HttpResponse.json(
      automationDto({ id: String(params['id']), enabled: false, nextTriggerAt: undefined }),
    ),
  ),
  http.get(`${API_BASE}/api/automations/:id/runs`, ({ params, request }) => {
    // 游标替身：`before` 缺席 = 第一页；带 `before` = 严格早于那条（与后端同语义）。
    const url = new URL(request.url);
    const before = url.searchParams.get('before');
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
    const all = AUTOMATION_RUN_FIXTURES.map((run) => ({
      ...run,
      automationId: String(params['id']),
    }));
    const start = before === null ? 0 : all.findIndex((r) => r.id === before) + 1;
    const slice = all.slice(start, start + limit);
    return HttpResponse.json({
      items: slice,
      hasMore: start + limit < all.length,
    });
  }),

  http.get(`${API_BASE}/api/automations/runs/:runId`, ({ params }) =>
    HttpResponse.json(
      automationRunDto({
        id: String(params['runId']),
        outputSummary: '…最后 1KB 输出…',
        sandboxId: 'sbx-demo',
      }),
    ),
  ),
  http.post(
    `${API_BASE}/api/automations/webhook-test`,
    // ⚠️ 总是 200，成败在 body 的 ok 里（后端 @HttpCode(200)）—— 不是 204 空体。
    () => HttpResponse.json({ ok: true, message: '目标返回 200' }),
  ),

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

  // ————————————————————————————————————————————————————————————————
  // 平台级审计流（10 §6.6.1 / F21-5 §3A）。
  //
  // ⚠️ 这个替身**真的实现了双向游标**，不是"返回固定一页"：`since` / `before` 语义写错
  // （尤其 `since` 取"最旧的 n 条"而不是"最新的 n 条"）在前端表现为增量永远追不上头部，
  // 而一个只会回定长页的替身根本测不出来。取值与顺序对齐 `audit.repository.ts`：
  // **恒按 seq 降序**，`hasMore` 用「多取一条」判定。
  //
  // ⚠️ `severity` 同理，**必须在这里（服务端一侧）筛**：它是逗号分隔多值、后端 `IN (...)`，
  // 而且是**先筛后取最新 n 条**。替身若不实现它，「仅告警」在 dev / e2e 里会把 info 也显示出来
  // ——那正是"前端与它自己的替身完全自洽、真后端从没进过回路"的形态。
  // ————————————————————————————————————————————————————————————————
  http.get(`${API_BASE}/api/system/audit`, ({ request }) => {
    const url = new URL(request.url);
    const num = (key: string): number | undefined => {
      const raw = url.searchParams.get(key);
      return raw === null ? undefined : Number(raw);
    };
    const since = num('since');
    const before = num('before');
    // 互斥：与后端 `audit.controller.ts` 同一个信封（同传 400 VALIDATION_FAILED）。
    if (since !== undefined && before !== undefined) {
      return HttpResponse.json(
        {
          code: 'VALIDATION_FAILED',
          message: '请求参数 since 与 before 互斥',
          retryable: false,
          sideEffectFree: true,
        },
        { status: 400 },
      );
    }
    const limit = num('limit') ?? 200;
    const category = url.searchParams.get('category');
    // 逗号分隔多值 → 集合；空串按"没给"处理（后端对非法值 400，这里不模拟那一支）。
    const severityRaw = url.searchParams.get('severity');
    const severities =
      severityRaw === null || severityRaw === ''
        ? null
        : severityRaw.split(',').filter((v) => v.length > 0);
    const subjectId = url.searchParams.get('subjectId');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    const matched = AUDIT_EVENTS.filter((e) => {
      if (since !== undefined && e.seq <= since) return false;
      if (before !== undefined && e.seq >= before) return false;
      if (category !== null && e.category !== category) return false;
      if (severities !== null && !severities.includes(e.severity)) return false;
      if (subjectId !== null && e.subjectId !== subjectId) return false;
      if (from !== null && Date.parse(e.at) < Date.parse(from)) return false;
      if (to !== null && Date.parse(e.at) > Date.parse(to)) return false;
      return true;
    });
    // 恒降序；`since` 方向取的同样是**最新的 n 条**（否则增量永远追不上风暴头部）。
    const body: AuditListDto = { items: matched.slice(0, limit), hasMore: matched.length > limit };
    return HttpResponse.json(body);
  }),

  // 导出：前端只触发下载、不解析 body，所以替身给一段字节流 + Content-Disposition 就够了。
  http.get(`${API_BASE}/api/system/audit/export`, () => auditExportSuccess()),

  // ————————————————————————————————————————————————————————————————
  // 系统状态与初始化的六个端点（10 §6.6 / F21-5 / F21-8）。
  //
  // ⚠️ 三个数值上的纪律（12 §3.4「替身的值不能凭空」）：
  //  ① **每个维度的 `level` 与 `usedPercent` 必须自洽**，且用后端那两套阈值算
  //     （CPU/RAM 80/95、磁盘 **75/90**，`system-resources.service.ts`）。替身随手把
  //     `disk: {usedPercent: 82, level: 'ok'}` 写在一起，前端"整体取最差维度"那条就永远
  //     测不出错——它拿到的输入本来就是错的。
  //  ② **`recentFailureRate` 在 `sampleSize === 0` 时缺席**（0/0 不是 0%）。替身补一个
  //     `0` 上去，「无样本」这一档在 dev / Storybook 里就再也不出现。
  //  ③ **诊断是真的 SSE 流**：`event: X\ndata: {...}\n\n`，一帧一段。回一个 JSON 数组
  //     的替身能让前端"看着能跑"，而真后端上第一帧就解析不了。
  // ————————————————————————————————————————————————————————————————
  http.get(`${API_BASE}/api/system/init-status`, () => HttpResponse.json(initStatusDto())),

  http.post(`${API_BASE}/api/system/init`, () =>
    HttpResponse.json(initStatusDto({ initialized: true, initializedAt: isoIn(0) }), {
      // ⚠️ 201 而不是 200：后端显式标了 `@ApiCreatedResponse`（Nest 对 POST 回 201）。
      status: 201,
    }),
  ),

  http.get(`${API_BASE}/api/system/settings`, () => HttpResponse.json(systemSettingsDto())),

  http.put(`${API_BASE}/api/system/settings`, async ({ request }) => {
    const body: unknown = await request.json();
    const proxy =
      typeof body === 'object' && body !== null && 'proxyConfig' in body
        ? Reflect.get(body, 'proxyConfig')
        : undefined;
    // 三态：`null` = 清空、缺席 = 不改、有值 = 改。替身照做，否则前端写出一个
    // "用户没动它 ⇒ 传 null" 的调用而测试全绿，真后端上会把代理配置清掉。
    if (proxy === null) return HttpResponse.json(systemSettingsDto({ proxyConfig: undefined }));
    return HttpResponse.json(systemSettingsDto());
  }),

  http.get(`${API_BASE}/api/system/resources`, () => HttpResponse.json(systemResourcesDto())),

  http.get(`${API_BASE}/api/system/providers`, () => HttpResponse.json(systemProvidersDto())),

  http.post(`${API_BASE}/api/system/diagnose`, () => diagnoseSseResponse(DIAGNOSE_FRAMES)),
];

function auditExportSuccess(): HttpResponse<Blob> {
  return new HttpResponse(new Blob(['fake-tar-gz']), {
    headers: {
      'content-type': 'application/gzip',
      'content-disposition': 'attachment; filename="audit-export.tar.gz"',
    },
  });
}

/**
 * **导出的失败路径替身**（`server.use(auditExportFailureHandler)` 覆盖上面那条）。
 *
 * ⚠️ 它不是可有可无的补充：后端刻意保留了「失败时返回 JSON 错误信封」的能力，而这个响应
 * **没有 `Content-Disposition`**、`content-type` 是 `application/json`——浏览器不会下载它，
 * 会**把当前标签页导航过去**。前端那个 `<a>` 因此必须带 `target="_blank"`
 * （见 `system.service.ts` 文件头 ②）：否则整个 SPA 连同用户的筛选与滚动位置一起
 * 被换成一张裸 JSON 错误页。默认恒 200 的替身让这条路径长期没有现场。
 */
export const auditExportFailureHandler = http.get(`${API_BASE}/api/system/audit/export`, () =>
  HttpResponse.json(
    {
      code: 'EXPORT_FAILED',
      message: '导出失败：磁盘空间不足',
      retryable: true,
      sideEffectFree: true,
    },
    { status: 500 },
  ),
);

// ————————————————————————————————————————————————————————————————
// 系统状态 / 初始化的替身数据与工厂
// ————————————————————————————————————————————————————————————————

function initStatusDto(overrides: Partial<InitStatusDto> = {}): InitStatusDto {
  return {
    initialized: true,
    initializedAt: isoIn(-30 * DAY),
    lastConnectivityCheck: [
      { target: 'https://api.openai.com', ok: true, latencyMs: 182, modelApi: true },
      {
        target: 'ghcr.io',
        ok: false,
        hint: '连接超时；如在内网请配置 HTTP_PROXY',
        modelApi: false,
      },
    ],
    lastConnectivityCheckAt: isoIn(-30 * DAY),
    ...overrides,
  };
}

function systemSettingsDto(overrides: Partial<SystemSettingsDto> = {}): SystemSettingsDto {
  return {
    initialized: true,
    proxyConfig: { httpProxy: 'http://127.0.0.1:7890', noProxy: 'localhost,127.0.0.1' },
    publicBaseUrl: 'http://localhost:3000',
    accessPasscodeEnabled: false,
    // ⛔ 永不回显口令 hash —— 后端的 DTO 里就没有这个字段，替身也不许"顺手"造一个。
    version: { platform: '1.1.0', node: process.version },
    ...overrides,
  };
}

const GB = 1024 ** 3;

/**
 * 资源水位。**每个维度的 `level` 都由它自己的 `usedPercent` 按后端阈值算出来**，
 * 不是随手填的：CPU/RAM 用 80/95，磁盘用 **75/90**（两套不同，见 `system-resources.service.ts`）。
 */
function systemResourcesDto(): SystemResourcesDto {
  const diskTotal = 200 * GB;
  const diskUsed = 150 * GB;
  const retainedBytes = 45 * GB;
  return {
    cpu: { cores: 8, loadAvg1m: 4.2, usedPercent: 52.5, level: 'ok' },
    ram: { totalBytes: 16 * GB, usedBytes: 5.8 * GB, usedPercent: 36.3, level: 'ok' },
    disk: {
      path: '/data',
      totalBytes: diskTotal,
      usedBytes: diskUsed,
      availableBytes: diskTotal - diskUsed,
      usedPercent: 75,
      // 75% 恰好踩在磁盘的 ⚠️ 线上（后端 `percent >= 75 ⇒ warn`）——替身刻意站在边界上，
      // 因为"整体取最差维度"这条只有在**某一维度不是 ok** 的时候才有得测。
      level: 'warn',
      reservedPercent: 15,
    },
    retainedVolumes: {
      count: 12,
      totalBytes: retainedBytes,
      percentOfDisk: 22.5,
      level: 'ok',
      oldestExpiresAt: isoIn(6 * DAY),
      truncated: false,
    },
    activeTasks: 5,
  };
}

/**
 * provider 健康看板。
 *
 * ⚠️ **第一个 provider 有样本、第二个没有**：`recentFailureRate` 在无样本时**缺席**
 * （0/0 不是 0%，后端刻意的）。两种都喂，才让「无样本」那一档在 dev / Storybook 里真出现。
 * ⚠️ 能力位逐位取自 `PROVIDER_REGISTRY`（同一份注册表，不另抄一遍）。
 */
function systemProvidersDto(): SystemProvidersDto {
  const [first, second] = PROVIDER_REGISTRY;
  const providers: SystemProvidersDto['providers'] = [];
  if (first !== undefined) {
    providers.push({
      id: first.name,
      capabilities: first.capabilities,
      isDefault: first.isDefault,
      healthy: true,
      // 5% ⇒ ⚠️（>1%）但仍 healthy（未越过 10% 的 ❌ 线）——这正是「只看 healthy 会把
      // 5% 画成全绿」那个错法的现场。
      recentFailureRate: 0.05,
      sampleSize: 40,
      failureCount: 2,
    });
  }
  if (second !== undefined) {
    providers.push({
      id: second.name,
      capabilities: second.capabilities,
      isDefault: second.isDefault,
      // 无样本 ⇒ 后端把 healthy 置 true，但**不给** recentFailureRate。
      healthy: true,
      sampleSize: 0,
      failureCount: 0,
    });
  }
  return {
    providers,
    runtimes: RUNTIME_REGISTRY.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      vendor: r.vendor,
      authMethods: [...r.authMethods],
      credentialConfigured: r.credentialStatus !== 'none',
    })),
    imageSpecs: [{ id: 'oci', isDefault: true }],
    healthWindowMs: 60 * 60 * 1000,
  };
}

/**
 * 诊断八帧（顺序 = `DIAGNOSE_CHECK_IDS`）。
 *
 * ⚠️ 这组取值刻意覆盖四种结论 + 两条产品硬要求：
 *  · `port-conflict` 是 **fail**，`summary` 里带着**端口号 · 进程名与 pid · 平台原本要用它
 *    做什么**（P21-5 §9B：只报"被占用"等于把诊断最有用的部分丢掉）；
 *  · `preset-image` 是 **info + step:'staged'**（P21-5 §9A 第 5 步**不是失败**）。
 *    替身把它写成 warn/fail，前端那条"info 渲染 ℹ️"的分支在 dev 里就永远看不到。
 */
const DIAGNOSE_FRAMES: readonly DiagnoseServerFrame[] = [
  {
    event: 'start',
    checks: [
      { id: 'container-runtime', label: '容器运行时可达' },
      { id: 'dev-kvm', label: '/dev/kvm 可用（boxlite 微 VM）' },
      { id: 'disk-space', label: '磁盘余量（DATA_ROOT）' },
      { id: 'port-conflict', label: '端口占用' },
      { id: 'outbound-network', label: '外网连通（模型 API / 镜像仓库）' },
      { id: 'ws-loopback', label: 'WS 回环' },
      { id: 'data-root-fs', label: 'DATA_ROOT 文件系统' },
      { id: 'preset-image', label: '预制镜像就绪' },
    ],
    timeoutMs: 5000,
  },
  {
    event: 'check',
    id: 'container-runtime',
    label: '容器运行时可达',
    status: 'ok',
    summary: 'aio：docker socket 可达（/var/run/docker.sock），版本 27.3.1',
    durationMs: 142,
  },
  {
    event: 'check',
    id: 'dev-kvm',
    label: '/dev/kvm 可用（boxlite 微 VM）',
    status: 'ok',
    summary: '/dev/kvm 存在且当前用户可读写',
    durationMs: 6,
  },
  {
    event: 'check',
    id: 'disk-space',
    label: '磁盘余量（DATA_ROOT）',
    status: 'ok',
    summary: '/data 剩余 50 GB（共 200 GB，已用 75%）',
    durationMs: 11,
  },
  {
    event: 'check',
    id: 'port-conflict',
    label: '端口占用',
    status: 'fail',
    // ⚠️ 三样齐全：端口号 · 进程名 (pid) · 平台原本要用它做什么。
    summary:
      '端口 3000（平台 HTTP/WS 服务（REST · /events · /terminal · /tasks 同一端口））被 com.docke (pid 41235) 占用',
    hint: '先确认它是什么：lsof -nP -iTCP:3000 -sTCP:LISTEN；确实该让路就停掉它，否则给平台换一个端口：PORT=<其它端口> 重启平台',
    detail: {
      conflicts: [
        {
          port: 3000,
          purpose: '平台 HTTP/WS 服务（REST · /events · /terminal · /tasks 同一端口）',
          holders: [{ pid: 41235, command: 'com.docke' }],
        },
      ],
    },
    durationMs: 312,
  },
  {
    event: 'check',
    id: 'outbound-network',
    label: '外网连通（模型 API / 镜像仓库）',
    status: 'warn',
    summary: 'api.openai.com 可达（182ms）；ghcr.io 连接超时',
    hint: 'HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 重启平台',
    durationMs: 5000,
  },
  {
    event: 'check',
    id: 'ws-loopback',
    label: 'WS 回环',
    status: 'ok',
    summary: '本机 /events 握手 + 回环帧往返 8ms',
    durationMs: 24,
  },
  {
    event: 'check',
    id: 'data-root-fs',
    label: 'DATA_ROOT 文件系统',
    status: 'warn',
    summary: '/data 文件系统为 ext4，不支持 reflink —— CoW 加速功能受限',
    hint: '换用支持 reflink 的文件系统（Btrfs / XFS）承载 DATA_ROOT',
    durationMs: 9,
  },
  {
    event: 'check',
    id: 'preset-image',
    label: '预制镜像就绪',
    // ⚠️ **info 不是 warn**：镜像是好的，只是本机还没铺开（P21-5 §9A 第 5 步）。
    status: 'info',
    step: 'staged',
    summary:
      '预制镜像已就绪，但尚未在本机铺开 —— **首个任务需要数分钟准备镜像**（13GB 镜像实测冷启动约 190 秒），之后每次 3–4 秒',
    hint: '不需要任何操作：第一个任务会自动拉取并铺开；想提前铺可以先跑一个空任务',
    durationMs: 431,
  },
  {
    event: 'done',
    okCount: 4,
    infoCount: 1,
    warnCount: 2,
    // ⚠️ 含 timeout（这一轮没有超时项，所以就是那 1 个 fail）。
    failCount: 1,
    // ⚠️ 八项**并行** ⇒ 整轮 ≈ 最慢那项（5000ms），不是各项之和。
    totalMs: 5012,
  },
];

/**
 * 把若干帧写成一条真的 SSE 流。
 *
 * ⚠️ `event:` 行与帧体里的 `event` 字段**都要有**（后端 `SseWriter` 就是这么写的）：
 * 前者给 `EventSource` 那条消费路径，后者给 `fetch` + `ReadableStream` 那条。
 * 替身少写 `event:` 行今天不会有人发现（本仓走后者），但它会让"照替身写的解析器"
 * 在换回 EventSource 的那天静默收不到任何东西。
 */
export function diagnoseSseResponse(
  frames: readonly DiagnoseServerFrame[],
): HttpResponse<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(
          encoder.encode(`event: ${frame.event}\ndata: ${JSON.stringify(frame)}\n\n`),
        );
      }
      controller.close();
    },
  });
  return new HttpResponse(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-schema-hash': SSE_DIAGNOSE_SCHEMA_HASH,
    },
  });
}

/**
 * **断流替身**（`server.use(diagnoseAbortedHandler)`）：发完前三项就把流掐掉，
 * 一个 `done` 帧都不给。
 *
 * ⚠️ 它不是可有可无的补充：F21-5 §8 要求断流时**保留已到达项** + 显示「诊断中断」。
 * 默认那条恒完整的替身让这条路径长期没有现场，而"中断时把已有结果一起清空"这种写法
 * 在完整流下表现完全正常。
 */
export const diagnoseAbortedHandler = http.post(`${API_BASE}/api/system/diagnose`, () =>
  diagnoseSseResponse(DIAGNOSE_FRAMES.slice(0, 3)),
);
