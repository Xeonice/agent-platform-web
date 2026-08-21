// 沙箱 provider 领域类型。REST 权威形状一律来自后端生成物（generate:api → openapi.d.ts），
// 与 runtimeCredential.ts 同构，杜绝手写漂移。
import type { components } from '@/types/generated/openapi';

/**
 * provider 标识：后端是**开放 registry**（第三方可注册），前端不得枚举闭集。
 * 历史：S1 曾在此写死 `SANDBOX_PROVIDERS = ['aio','boxlite']` + `DEFAULT_SANDBOX_PROVIDER`，
 * 导致后端注册的第三方 provider 在 UI 里根本看不见 —— 已改为服务端数据驱动（GET /api/providers）。
 * 值透传进 CreateSandboxDto.provider（生成物里就是自由字符串）。
 */
export type SandboxProvider = string;

/** GET /api/providers 数组项：name + 能力位 + 是否默认档（**默认档在每项上，无顶层字段**）。 */
export type SandboxProviderDto = components['schemas']['ProviderResponseDto'];

/** 逐 provider 能力位（6 位全 required）：驱动按能力显隐，今天只消费 spawnTty。 */
export type SandboxProviderCapabilities = SandboxProviderDto['capabilities'];

/**
 * 建沙箱时的能力静态校验诉求（CreateSandboxDto.require，不满足 → 409）。
 * 本期**不发送**（没有对应 UI 入口）；此别名只是把口子在类型上标出来，
 * 后续若加「必须支持快照/暂停」之类的勾选，直接填进 createSandbox 的 body 即可。
 */
export type SandboxCapabilityRequire = NonNullable<
  components['schemas']['CreateSandboxDto']['require']
>;
