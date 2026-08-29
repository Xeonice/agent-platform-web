// F21-5 §7.1 `lib/providerHealth`：失败率三点边界 + **无样本第四档**。
import { describe, it, expect } from 'vitest';
import {
  capabilityText,
  healthWindowText,
  providerFailureText,
  providerHealthLevel,
  providerStatusModel,
} from '@/lib/system/providerModel';
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

describe('providerHealthLevel —— 三点边界（>1% ⚠️ · >10% ❌）', () => {
  it('0.9% ⇒ ok', () => {
    expect(providerHealthLevel(provider({ recentFailureRate: 0.009 }))).toBe('ok');
  });
  it('1.1% ⇒ warning', () => {
    expect(providerHealthLevel(provider({ recentFailureRate: 0.011 }))).toBe('warning');
  });
  it('10.1% ⇒ error', () => {
    expect(providerHealthLevel(provider({ recentFailureRate: 0.101 }))).toBe('error');
  });
  it('恰好 10% 仍是 warning —— 与后端 `rate <= 0.1 ⇒ healthy` 同向，两边不在这个点上打架', () => {
    expect(providerHealthLevel(provider({ recentFailureRate: 0.1 }))).toBe('warning');
  });
});

describe('⭐「无样本」是第四档，不是 0%', () => {
  it('`recentFailureRate` 缺席 ⇒ `no-sample`，⛔ 不是 `ok`', () => {
    // ⚠️ 这是本文件的核心：后端在 `sampleSize === 0` 时**刻意不下发**这个字段（0/0 不是 0%）。
    //    前端 `?? 0` 掉之后，一台这一小时没人用过的机器会显示「失败率 0% ✅」——
    //    一个看起来是实测结论、实际上零样本的绿灯。
    const p = provider({ sampleSize: 0, failureCount: 0 });
    expect(p.recentFailureRate).toBeUndefined();
    expect(providerHealthLevel(p)).toBe('no-sample');
    expect(providerHealthLevel(p)).not.toBe('ok');
  });

  it('无样本那句话里**一个百分数都没有**（有数字就会被当成一次实测）', () => {
    const text = providerFailureText(provider({ sampleSize: 0, failureCount: 0 }));
    expect(text).toContain('无样本');
    expect(text).not.toMatch(/\d+(\.\d+)?%/);
  });

  it('有样本时把分子分母都说出来（5%（2/40）——只给百分比看不出样本有多小）', () => {
    expect(
      providerFailureText(provider({ recentFailureRate: 0.05, sampleSize: 40, failureCount: 2 })),
    ).toBe('最近 1h 失败率 5%（2/40）');
  });
});

describe('capabilityText / healthWindowText', () => {
  it('只列已开启的能力位（7 个全列出来含一串 false，没人读得下去）', () => {
    expect(capabilityText(CAPS)).toBe('spawnTty · volumeMount · watchEvents · headlessTask');
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

describe('providerStatusModel', () => {
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
    expect(providerStatusModel(dto).providers[0]?.level).toBe('warning');
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
    const row = providerStatusModel(dto).runtimes[0];
    expect(row?.credentialText).toBe('凭证未配置');
    expect(row?.authMethodsText).toBe('setup-token · api-key');
    expect(row?.vendor).toBe('Anthropic');
  });
});
