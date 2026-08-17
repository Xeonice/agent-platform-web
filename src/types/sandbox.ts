// 沙箱 provider 档位（S1）：后端同时支持 aio / boxlite，前端"新建沙箱"入口可选，默认 aio。
// 值透传进 CreateSandboxDto.provider（contract 里 provider 是自由字符串，这里收敛成前端可选枚举）。
export const SANDBOX_PROVIDERS = ['aio', 'boxlite'] as const;
export type SandboxProvider = (typeof SANDBOX_PROVIDERS)[number];
export const DEFAULT_SANDBOX_PROVIDER: SandboxProvider = 'aio';
