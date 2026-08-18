// Git 平台注册表：SaaS 平台（github/gitlab/gitee）的 label + 默认 host 的**单一来源**。
// 加一个平台只改这一处 map；`Record<Exclude<GitPlatform,'other'>, …>` 由 TS 强制覆盖
// openapi 枚举里所有非 'other' 平台——后端 registry 新增平台（openapi 枚举增长）而此 map 没跟上，
// TypeScript 编译即报错，不会静默漏（机器兜底）。
import type { GitPlatform } from '@/types/gitCredential';

/** 非 'other' 的具体平台（'other' 为自建，host 由用户手填，无固定 label/host）。 */
export type KnownGitPlatform = Exclude<GitPlatform, 'other'>;

export interface GitPlatformMeta {
  /** 平台 id（与所在 key 一致；便于从 Object.values 派生选项而无需类型断言）。 */
  value: KnownGitPlatform;
  /** UI 展示名。 */
  label: string;
  /** 选来源自动推导的固定 host。 */
  defaultHost: string;
}

/**
 * SaaS 平台注册表（单一来源）。类型 `Record<KnownGitPlatform, …>` 强制覆盖所有非 'other' 平台，
 * 漏一个即编译报错。
 */
export const GIT_PLATFORMS: Record<KnownGitPlatform, GitPlatformMeta> = {
  github: { value: 'github', label: 'GitHub', defaultHost: 'github.com' },
  gitlab: { value: 'gitlab', label: 'GitLab', defaultHost: 'gitlab.com' },
  gitee: { value: 'gitee', label: 'Gitee', defaultHost: 'gitee.com' },
};

/** 收窄守卫：platform 是否为注册表覆盖的具体 SaaS 平台（非 'other'）。 */
export function isKnownGitPlatform(platform: GitPlatform): platform is KnownGitPlatform {
  return platform !== 'other';
}

/** 选来源 UI 选项一项（表单单选）。 */
export interface GitPlatformOption {
  value: GitPlatform;
  label: string;
}

/**
 * 选来源 UI 选项：从 `GIT_PLATFORMS` 派生 SaaS 三家 + 末尾追加 'other'（自建，手填 host）。
 * 平台列表的唯一来源即 `GIT_PLATFORMS`，view 不再硬编码（经 hook 传入）。
 */
export const GIT_PLATFORM_OPTIONS: GitPlatformOption[] = [
  ...Object.values(GIT_PLATFORMS).map((meta) => ({ value: meta.value, label: meta.label })),
  { value: 'other', label: '其他（自建）' },
];
