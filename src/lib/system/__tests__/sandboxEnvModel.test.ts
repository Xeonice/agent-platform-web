// F21-5 §7.1 `lib/providerHealth`：失败率三点边界 + **无样本第四档**。
import { describe, it, expect } from 'vitest';
import {
  capabilityLabel,
  capabilityText,
  healthWindowText,
  sandboxEnvDisplayName,
  sandboxEnvFailureText,
  sandboxEnvHealthLevel,
  sandboxEnvStatusModel,
} from '@/lib/system/sandboxEnvModel';
import type { ProviderHealthDto, SystemProvidersDto } from '@/types/system';

const CAPS: ProviderHealthDto['capabilities'] = {
  spawnTty: true,
  volumeMount: true,
  updateResources: false,
  pauseResume: false,
  snapshot: false,
  watchEvents: true,
  headlessTask: true,
};

function provider(over: Partial<ProviderHealthDto> = {}): ProviderHealthDto {
  return {
    id: 'aio',
    capabilities: CAPS,
    isDefault: true,
    healthy: true,
    sampleSize: 100,
    failureCount: 0,
    ...over,
  };
}

describe('sandboxEnvHealthLevel —— 三点边界（>1% ⚠️ · >10% ❌）', () => {
  it('0.9% ⇒ ok', () => {
    expect(sandboxEnvHealthLevel(provider({ recentFailureRate: 0.009 }))).toBe('ok');
  });
  it('1.1% ⇒ warning', () => {
    expect(sandboxEnvHealthLevel(provider({ recentFailureRate: 0.011 }))).toBe('warning');
  });
  it('10.1% ⇒ error', () => {
    expect(sandboxEnvHealthLevel(provider({ recentFailureRate: 0.101 }))).toBe('error');
  });
  it('恰好 10% 仍是 warning —— 与后端 `rate <= 0.1 ⇒ healthy` 同向，两边不在这个点上打架', () => {
    expect(sandboxEnvHealthLevel(provider({ recentFailureRate: 0.1 }))).toBe('warning');
  });
});

describe('⭐「无样本」是第四档，不是 0%', () => {
  it('`recentFailureRate` 缺席 ⇒ `no-sample`，⛔ 不是 `ok`', () => {
    // ⚠️ 这是本文件的核心：后端在 `sampleSize === 0` 时**刻意不下发**这个字段（0/0 不是 0%）。
    //    前端 `?? 0` 掉之后，一台这一小时没人用过的机器会显示「失败率 0% ✅」——
    //    一个看起来是实测结论、实际上零样本的绿灯。
    const p = provider({ sampleSize: 0, failureCount: 0 });
    expect(p.recentFailureRate).toBeUndefined();
    expect(sandboxEnvHealthLevel(p)).toBe('no-sample');
    expect(sandboxEnvHealthLevel(p)).not.toBe('ok');
  });

  it('无样本那句话里**一个百分数都没有**（有数字就会被当成一次实测）', () => {
    const text = sandboxEnvFailureText(provider({ sampleSize: 0, failureCount: 0 }));
    expect(text).toContain('无样本');
    expect(text).not.toMatch(/\d+(\.\d+)?%/);
  });

  it('有样本时把分子分母都说出来（5%（2/40）——只给百分比看不出样本有多小）', () => {
    expect(
      sandboxEnvFailureText(provider({ recentFailureRate: 0.05, sampleSize: 40, failureCount: 2 })),
    ).toBe('最近 1h 失败率 5%（2/40）');
  });
});

describe('capabilityText / healthWindowText', () => {
  /**
   * ⛔ **能力位键名不许原样上屏**（2026-09 修）：此前是 camelCase 键名直接 join，
   * 屏幕上出现「能力：spawnTty · volumeMount · …」—— 那是内部字段名，界面上没有任何
   * 地方解释它们。
   * MUTATION：把 `capabilityLabel()` 换回 `([name]) => name` ⇒ 本条红。
   */
  it('只列已开启的能力位，且键名翻成中文（⛔ 不许把 camelCase 原样上屏）', () => {
    expect(capabilityText(CAPS)).toBe('交互式终端 · 挂载工作区目录 · 状态变化推送 · 无人值守任务');
  });

  /**
   * ⭐ **能力位是开放集合**（第三方 provider 会带自己的位）：表里没有的键**原样给出**，
   * ⛔ 不许丢掉 —— 少列一项会被读成"它没有这个能力"，比列出一个英文名糟得多。
   */
  it('⭐ 未知能力位回退原名，而不是被丢掉', () => {
    expect(capabilityLabel('spawnTty')).toBe('交互式终端');
    expect(capabilityLabel('teleportViaWormhole')).toBe('teleportViaWormhole');
    // 开放集合：第三方 provider 带来的位在契约里没有键，所以走 Record 形态构造入参
    // （`capabilityText` 的实现只 `Object.entries`，键集合本来就不受契约约束）。
    const withUnknown: Record<string, boolean> = { ...CAPS, teleportViaWormhole: true };
    expect(capabilityText(withUnknown)).toContain('teleportViaWormhole');
  });

  /**
   * ⭐ 光一个 `aio` / `boxlite` 摆在屏幕上，用户无从判断哪个是哪个（P21-5 §3 原型带括号）。
   * ⛔ 但 provider 是**开放注册表**：未知 id 原样返回，不编一个括号说明。
   */
  it('⭐ 沙箱环境上屏名：已知的带中文说明，未知的原样用 id', () => {
    expect(sandboxEnvDisplayName('aio')).toBe('aio（容器运行时）');
    expect(sandboxEnvDisplayName('boxlite')).toBe('boxlite（微 VM）');
    expect(sandboxEnvDisplayName('custom-xx')).toBe('custom-xx');
  });
  it('一个都没开 ⇒ 说「无声明能力」而不是空字符串', () => {
    expect(
      capabilityText({
        spawnTty: false,
        volumeMount: false,
        updateResources: false,
        pauseResume: false,
        snapshot: false,
        watchEvents: false,
        headlessTask: false,
      }),
    ).toBe('无声明能力');
  });
  it('窗口文案取自后端下发的 `healthWindowMs`，不写死 1h', () => {
    expect(healthWindowText(60 * 60 * 1000)).toBe('最近 1 小时');
    expect(healthWindowText(15 * 60 * 1000)).toBe('最近 15 分钟');
  });
});

describe('sandboxEnvStatusModel', () => {
  it('⭐ 只看 `healthy` 会把 5% 画成全绿 —— 分档必须独立于它', () => {
    const dto: SystemProvidersDto = {
      providers: [
        // 后端：5% ≤ 10% ⇒ healthy: true。但产品要求 >1% 就是 ⚠️。
        provider({
          id: 'aio',
          healthy: true,
          recentFailureRate: 0.05,
          sampleSize: 40,
          failureCount: 2,
        }),
      ],
      runtimes: [],
      imageSpecs: [],
      healthWindowMs: 3_600_000,
    };
    expect(sandboxEnvStatusModel(dto).providers[0]?.level).toBe('warning');
  });

  it('runtime 行把「凭证未配置」说成人话，且不丢 vendor / 授权方式', () => {
    const dto: SystemProvidersDto = {
      providers: [],
      runtimes: [
        {
          id: 'claude-code',
          displayName: 'Claude Code',
          vendor: 'Anthropic',
          authMethods: ['setup-token', 'api-key'],
          credentialConfigured: false,
        },
      ],
      imageSpecs: [],
      healthWindowMs: 3_600_000,
    };
    const row = sandboxEnvStatusModel(dto).runtimes[0];
    expect(row?.credentialText).toBe('凭证未配置');
    expect(row?.authMethodsText).toBe('setup-token · api-key');
    expect(row?.vendor).toBe('Anthropic');
  });
});
