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
  isDismissedToday,
  pruneDismissed,
  todayKey,
} from '@/lib/system/globalBanner';
import type { ConnectivityResultDto } from '@/types/init';
import type { AutomationAttention } from '@/types/automation';

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

// ————————————————————————————————————————————————————————————————
// ⚠️ 治理类横幅（design-notes.md §4 Phase 3 第 3 条「全局横幅优先级」）：
// 唯一的生产方是 `lib/automation/automationAttention.ts`，本文件只测**接线**——
// 文案是否正确由那份文件自己的测试钉住，这里不重复断言文案内容的每一个字。
// ————————————————————————————————————————————————————————————————
const NEEDS_ATTENTION: AutomationAttention = {
  hasData: true,
  autoDisabledCount: 2,
  degradedCount: 0,
  needsAttention: true,
  title: '有 2 条定时规则已自动停用',
  description: '2 条连着失败 10 次后已经不再触发，要重新开启才会继续跑。',
  actionLabel: '查看这些规则',
};
const NO_ATTENTION: AutomationAttention = {
  hasData: true,
  autoDisabledCount: 0,
  degradedCount: 0,
  needsAttention: false,
};

describe('治理类横幅（automation-needs-attention）', () => {
  it('needsAttention ⇒ 出一条 warning，文案直接取 automationAttention 的三个字段', () => {
    const banners = globalBanners({
      connectivity: check([openai, anthropic, registry]),
      automation: NEEDS_ATTENTION,
    });
    expect(banners).toHaveLength(1);
    expect(banners[0]).toEqual({
      id: 'automation-needs-attention',
      severity: 'warning',
      title: NEEDS_ATTENTION.title,
      description: NEEDS_ATTENTION.description,
      actionLabel: NEEDS_ATTENTION.actionLabel,
    });
  });

  it('needsAttention:false ⇒ 不出这条横幅', () => {
    expect(
      globalBanners({
        connectivity: check([openai, anthropic, registry]),
        automation: NO_ATTENTION,
      }),
    ).toEqual([]);
  });

  /**
   * ⭐ **省略 `automation` 字段要与「显式传 NO_ATTENTION」等价**——这条钉住
   * `GlobalBannerInput.automation` 是可选字段，既有调用点（本文件前面几十个 `globalBanners({...})`）
   * 不必逐个补这一位。变异：把 `input.automation ?? NO_AUTOMATION_ATTENTION` 里的 `??`
   * 去掉（改成直接 `input.automation.needsAttention`）⇒ 本例抛异常而不是回空数组。
   */
  it('⭐ 省略 automation 字段 ⇒ 不出治理类横幅、也不抛错（可选字段的兜底）', () => {
    expect(globalBanners({ connectivity: check([openai, anthropic, registry]) })).toEqual([]);
  });

  /**
   * ⭐⭐ **三色分层的核心断言**：阻断 > 治理，三条同时命中时排序必须是
   * `platform-state-unknown` → `offline` → `automation-needs-attention`。
   *
   * 变异：把 `BANNER_RANK['automation-needs-attention']` 改成 `0` ⇒ 本例的顺序断言变红；
   * 把 `NEEDS_ATTENTION` 的 severity 判定去掉、让它也走 `severity:'blocking'` 分支
   * ⇒ 下面 `severity` 那句变红。
   */
  it('⭐⭐ 三条同时命中 ⇒ 阻断（2 条）排在治理（1 条）之前', () => {
    const banners = globalBanners({
      connectivity: check([down(openai), down(anthropic)]),
      statusUnavailableReason: '连接被拒绝',
      automation: NEEDS_ATTENTION,
    });
    const stacked = bannerStackModel(banners, []);
    expect(stacked.banners.map((b) => b.id)).toEqual([
      'platform-state-unknown',
      'offline',
      'automation-needs-attention',
    ]);
    expect(stacked.banners.map((b) => b.severity)).toEqual(['blocking', 'blocking', 'warning']);
  });
});

describe('治理类的「关闭后当天不再弹」（isDismissedToday，与阻断类的会话级关闭是两套机制）', () => {
  // ⚠️ `todayKey` 按**本地**日历日算（`getFullYear`/`getMonth`/`getDate`，不是 UTC）——
  // "今天"要匹配用户自己时区里的"今天"，不是格林尼治的。夹具因此**用本地时间构造函数**
  // （`new Date(y, m, d, h)`，月份从 0 开始），⛔ 不用 ISO/UTC 字符串——那样在 UTC+8 之类
  // 的时区里，`T23:59:00.000Z` 已经是本地日历的第二天，会把"同一天"的夹具错造成"跨天"。
  const DAY_1 = new Date(2026, 7, 29, 10, 0, 0);
  const DAY_1_LATER = new Date(2026, 7, 29, 23, 59, 0);
  const DAY_2 = new Date(2026, 7, 30, 0, 0, 1);

  it('todayKey 只取年月日，同一天内多次调用相等', () => {
    expect(todayKey(DAY_1)).toBe(todayKey(DAY_1_LATER));
    expect(todayKey(DAY_1)).not.toBe(todayKey(DAY_2));
  });

  it('记录的日期等于今天 ⇒ 算已关闭', () => {
    const record = { 'automation-needs-attention': todayKey(DAY_1) };
    expect(isDismissedToday('automation-needs-attention', record, DAY_1_LATER)).toBe(true);
  });

  /**
   * ⭐ 跨天 ⇒ 记录自然失效——**不需要**任何回收步骤（与阻断类的 `pruneDismissed` 不同）。
   * 变异：把比较从"日期字符串相等"改成"记录存在即算关闭" ⇒ 本例变红。
   */
  it('⭐ 跨天 ⇒ 记录自动失效，不再算已关闭', () => {
    const record = { 'automation-needs-attention': todayKey(DAY_1) };
    expect(isDismissedToday('automation-needs-attention', record, DAY_2)).toBe(false);
  });

  it('没有记录 ⇒ 不算已关闭', () => {
    expect(isDismissedToday('automation-needs-attention', {}, DAY_1)).toBe(false);
  });
});
