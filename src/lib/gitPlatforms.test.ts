import { describe, it, expect } from 'vitest';
import {
  GIT_PLATFORMS,
  GIT_PLATFORM_OPTIONS,
  isKnownGitPlatform,
  type KnownGitPlatform,
} from '@/lib/gitPlatforms';
import { platformToHost } from '@/lib/gitCredential';
import type { GitPlatform } from '@/types/gitCredential';

// openapi 生成的 GitPlatform 枚举全集（新增平台时此常量会随生成物变化，配合 Record 强制覆盖）。
const ALL_PLATFORMS: GitPlatform[] = ['github', 'gitlab', 'gitee', 'other'];
const KNOWN_PLATFORMS: KnownGitPlatform[] = ['github', 'gitlab', 'gitee'];

describe('GIT_PLATFORMS（SaaS 平台注册表——单一来源）', () => {
  it('覆盖所有非 other 平台（TS Record 已强制，这里加一条运行时断言兜底）', () => {
    for (const p of KNOWN_PLATFORMS) {
      expect(GIT_PLATFORMS).toHaveProperty(p);
      expect(GIT_PLATFORMS[p].defaultHost).toBeTruthy();
      expect(GIT_PLATFORMS[p].label).toBeTruthy();
      // 内层 value 与所在 key 一致（Object.values 派生选项的前提）。
      expect(GIT_PLATFORMS[p].value).toBe(p);
    }
    // 注册表不含 other（自建无固定 host/label）。
    expect(GIT_PLATFORMS).not.toHaveProperty('other');
  });

  it('label / defaultHost 与预期一致', () => {
    expect(GIT_PLATFORMS.github).toEqual({
      value: 'github',
      label: 'GitHub',
      defaultHost: 'github.com',
    });
    expect(GIT_PLATFORMS.gitlab).toEqual({
      value: 'gitlab',
      label: 'GitLab',
      defaultHost: 'gitlab.com',
    });
    expect(GIT_PLATFORMS.gitee).toEqual({
      value: 'gitee',
      label: 'Gitee',
      defaultHost: 'gitee.com',
    });
  });
});

describe('isKnownGitPlatform', () => {
  it('SaaS 三家为 true，other 为 false', () => {
    expect(isKnownGitPlatform('github')).toBe(true);
    expect(isKnownGitPlatform('gitlab')).toBe(true);
    expect(isKnownGitPlatform('gitee')).toBe(true);
    expect(isKnownGitPlatform('other')).toBe(false);
  });
});

describe('GIT_PLATFORM_OPTIONS（表单选项——从注册表派生 + 末尾 other）', () => {
  it('SaaS 三家来自注册表，末尾追加 other（自建）', () => {
    expect(GIT_PLATFORM_OPTIONS).toEqual([
      { value: 'github', label: 'GitHub' },
      { value: 'gitlab', label: 'GitLab' },
      { value: 'gitee', label: 'Gitee' },
      { value: 'other', label: '其他（自建）' },
    ]);
  });

  it('选项覆盖 GitPlatform 全集，无遗漏无多余', () => {
    const optionValues = GIT_PLATFORM_OPTIONS.map((o) => o.value).sort();
    expect(optionValues).toEqual([...ALL_PLATFORMS].sort());
  });
});

describe('platformToHost 走注册表（与 GIT_PLATFORMS 保持一致）', () => {
  it('每个 SaaS 平台返回注册表 defaultHost', () => {
    for (const p of KNOWN_PLATFORMS) {
      expect(platformToHost(p)).toBe(GIT_PLATFORMS[p].defaultHost);
    }
  });
  it('other → null', () => {
    expect(platformToHost('other')).toBeNull();
  });
});
