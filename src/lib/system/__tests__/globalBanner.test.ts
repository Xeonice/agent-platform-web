// `lib/system/globalBanner.ts` 的判定与文案（F21-8 §4 / 07 §8.4）。
//
// ⭐ **本文件里最重要的是三条否定断言**，它们各自钉住一个"改完页面看起来完全正常"的写法：
//    · 「读不到平台状态」的那条横幅里**不许出现「离线」两个字**（把 error 当离线时它红）；
//    · 「一条快照都没有」时**一条横幅都不出**（把 `hasResult` 判据删掉时它红）；
//    · 「只有镜像仓库不可达」时**不出离线横幅**（把 `modelApi` 那层判定绕开时它红）。
import { describe, it, expect } from 'vitest';
import { connectivityCheckModel } from '@/lib/system/connectivityVerdict';
import {
  OFFLINE_ACTION_DISABLED_REASON,
  bannerStackModel,
  globalBanners,
  pruneDismissed,
} from '@/lib/system/globalBanner';
import type { ConnectivityResultDto } from '@/types/init';

const openai: ConnectivityResultDto = { target: 'api.openai.com', ok: true, modelApi: true };
const anthropic: ConnectivityResultDto = { target: 'api.anthropic.com', ok: true, modelApi: true };
const registry: ConnectivityResultDto = { target: 'ghcr.io', ok: true, modelApi: false };
const down = (r: ConnectivityResultDto): ConnectivityResultDto => ({ ...r, ok: false });

const NOW = Date.parse('2026-08-29T17:00:00.000Z');

function check(rows: ConnectivityResultDto[] | undefined, checkedAt?: string) {
  return connectivityCheckModel(
    { rows, ...(checkedAt === undefined ? {} : { checkedAt }), fromHistory: true },
    NOW,
  );
}

describe('离线横幅（P21-8 §5 状态矩阵最后一行）', () => {
  it('⭐ 模型 API 全不可达（镜像仓库通着）⇒ 出 🔴「离线模式：Agent 不可用 [重新检测]」', () => {
    const banners = globalBanners({
      connectivity: check([down(openai), down(anthropic), registry]),
    });
    expect(banners).toHaveLength(1);
    expect(banners[0]?.id).toBe('offline');
    expect(banners[0]?.severity).toBe('blocking');
    expect(banners[0]?.title).toContain('Agent 不可用');
    expect(banners[0]?.actionLabel).toBe('重新检测');
    // 必须说清"哪一半还好着"——只说不可用会让用户以为整台平台废了。
    expect(banners[0]?.description).toContain('照常可用');
  });

  it('⭐ 只有镜像仓库不可达（partial）⇒ **一条横幅都不出**：Agent 一直好好的', () => {
    expect(globalBanners({ connectivity: check([openai, anthropic, down(registry)]) })).toEqual([]);
  });

  it('全部可达 ⇒ 不出横幅', () => {
    expect(globalBanners({ connectivity: check([openai, anthropic, registry]) })).toEqual([]);
  });

  it('一条快照都没有 ⇒ 不出横幅', () => {
    const model = check(undefined);
    expect(model.hasResult).toBe(false);
    expect(globalBanners({ connectivity: model })).toEqual([]);
  });

  /**
   * ⭐ **判据必须同时读 `hasResult` 与 `verdict`。**
   *
   * ⚠️ 上面那条用例**证伪不了**这件事：`connectivityVerdict([])` 今天兜底成 `'ok'`，
   * 于是把 `hasResult &&` 删掉，空快照照样不出横幅、上面那条照样绿。而那份兜底是
   * **上游的实现细节**（`connectivityVerdict.ts` 注释里明写"调用方用 hasResult 区分
   * 没测过，不要靠 verdict 反推"）—— 它一旦改口径（比如空数组改判 `'partial'` 或
   * 直接改判离线），本文件就会静默地开始对每一台新装机器报红。
   *
   * ⇒ 这里**直接构造**「没测过 + verdict 恰好是 offline」这一对，把两个字段的读取
   *   钉在契约上，而不是钉在上游兜底值的当前取值上。
   */
  it('⭐ `hasResult:false` 时即便 verdict 是 offline 也不出横幅（不靠上游兜底值成立）', () => {
    expect(
      globalBanners({
        connectivity: {
          rows: [],
          verdict: 'offline',
          verdictText: '（构造：上游兜底值若改口径就会长这样）',
          fromHistory: true,
          hasResult: false,
        },
      }),
    ).toEqual([]);
  });

  it('快照带时刻时，横幅正文里必须带上它（"三秒前"与"三周前"是两件事）', () => {
    const banners = globalBanners({
      connectivity: check([down(openai), down(anthropic)], '2026-08-29T16:00:00.000Z'),
    });
    expect(banners[0]?.description).toContain('上次检测');
    expect(banners[0]?.description).toContain('1 小时前');
  });
});

describe('⭐「读不到平台状态」≠「离线」（globalBanner.ts ①）', () => {
  const banners = globalBanners({
    connectivity: check(undefined),
    statusUnavailableReason: '请求失败（HTTP 500）',
  });

  it('出的是 `platform-state-unknown`，不是 `offline`', () => {
    expect(banners.map((b) => b.id)).toEqual(['platform-state-unknown']);
  });

  it('⭐ 文案里**不出现「离线」**，且必须说出真正的成因（后端没起来）', () => {
    const text = `${banners[0]?.title ?? ''}${banners[0]?.description ?? ''}`;
    // 这一行是本文件的核心：把 error 当离线渲染时，它是唯一会红的断言。
    expect(text).not.toContain('离线模式');
    expect(text).toContain('后端没起来');
    // 后端那句人话原样带上，否则用户手里没有任何可查的线索。
    expect(text).toContain('HTTP 500');
  });

  it('⛔ 也不许反过来暗示"网络正常"——两种可能都要明写', () => {
    expect(banners[0]?.description).toContain('既不表示网络正常，也不表示离线');
  });

  it('状态读不到 + 诊断缓存里还留着离线结论 ⇒ 两条同时出，「状态未知」排在上面', () => {
    const both = bannerStackModel(
      globalBanners({
        connectivity: check([down(openai), down(anthropic)]),
        statusUnavailableReason: '连接被拒绝',
      }),
      [],
    );
    expect(both.banners.map((b) => b.id)).toEqual(['platform-state-unknown', 'offline']);
  });
});

describe('关闭与回收（07 §8.4：🔴 不自动收起、须显式关闭）', () => {
  const offline = globalBanners({ connectivity: check([down(openai), down(anthropic)]) });

  it('关闭后不再出现在栈里', () => {
    expect(bannerStackModel(offline, ['offline']).banners).toEqual([]);
  });

  it('⭐ 判定不再命中时，关闭记录一并回收——否则"关闭"就变成了**永久**的', () => {
    // 网络修好了（这一轮不产出 offline）⇒ 关闭记录被回收。
    expect(pruneDismissed(['offline'], [])).toEqual([]);
    // 于是网络再断时它会**重新出现**（这一次比第一次更该出现）。
    expect(bannerStackModel(offline, pruneDismissed(['offline'], [])).banners).toHaveLength(1);
  });

  it('仍然命中时，关闭记录保留（关掉的东西不许自己弹回来）', () => {
    expect(pruneDismissed(['offline'], offline)).toEqual(['offline']);
  });
});

describe('置灰理由（P21-8 §7 tooltip 文案）', () => {
  it('文案只有一份，横幅与 [+ 新任务] tooltip 共用', () => {
    expect(OFFLINE_ACTION_DISABLED_REASON).toBe('离线模式：需连接网络才能发起任务');
  });
});
