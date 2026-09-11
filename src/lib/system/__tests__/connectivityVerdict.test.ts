// F21-8 §7.1 `lib/connectivityVerdict.ts` 的四条 + 两条本轮补的。
//
// ⭐ **本文件的核心是两条互为镜像的证伪用例**（离线判定只看模型 API）：
//    · 「只有镜像仓库不可达 ⇒ partial」——把判定写成"任一目标挂了就离线"时它红；
//    · 「模型 API 全挂但镜像仓库可达 ⇒ offline」——把 `modelApi` 过滤删掉时它红。
//    两条都在，`filter(r => r.modelApi)` 这一句才真的被钉住；只留一条都能被绕过去。
import { describe, it, expect } from 'vitest';
import {
  connectivityCheckModel,
  connectivityFromDiagnoseDetail,
  connectivityVerdict,
  formatCheckedAt,
} from '@/lib/system/connectivityVerdict';
import type { ConnectivityResultDto } from '@/types/init';

const openai: ConnectivityResultDto = {
  target: 'api.openai.com',
  ok: true,
  latencyMs: 351,
  modelApi: true,
};
const anthropic: ConnectivityResultDto = {
  target: 'api.anthropic.com',
  ok: true,
  latencyMs: 1925,
  modelApi: true,
};
const registry: ConnectivityResultDto = {
  target: 'ghcr.io',
  ok: true,
  latencyMs: 6,
  modelApi: false,
};

const down = (r: ConnectivityResultDto, hint?: string): ConnectivityResultDto => ({
  ...r,
  ok: false,
  ...(hint === undefined ? {} : { hint }),
});

describe('connectivityVerdict（§7.1 四条）', () => {
  it('① 三项全 ✅ ⇒ ok', () => {
    expect(connectivityVerdict([openai, anthropic, registry])).toBe('ok');
  });

  it('⭐ ② 仅镜像仓库 ❌ ⇒ partial —— **不许**判成 offline', () => {
    const verdict = connectivityVerdict([openai, anthropic, down(registry)]);
    expect(verdict).toBe('partial');
    // ⚠️ 否定断言是这条的全部意义：一台只是内网镜像站没配好的机器，
    //    被告知「Agent 将不可用」是一个具体的谎（它的 Agent 一直好好的）。
    expect(verdict).not.toBe('offline');
  });

  it('⭐ ③ 两个模型 API 均 ❌ ⇒ offline —— **无论镜像仓库通不通**', () => {
    // 镜像仓库**可达**这一半是关键：把 `filter(modelApi)` 删掉的写法在这里会得到 partial。
    expect(connectivityVerdict([down(openai), down(anthropic), registry])).toBe('offline');
  });

  it('④ 全 ❌ ⇒ offline', () => {
    expect(connectivityVerdict([down(openai), down(anthropic), down(registry)])).toBe('offline');
  });

  it('一份不含任何模型 API 目标的结果 ⇒ 不是 offline（它只是没测那一类）', () => {
    // ⚠️ 少了 `modelApis.length > 0` 这个前置时，`[].every()` 恒 true ⇒ 会判成 offline，
    //    于是一次"只测了镜像仓库"的结果会把机器报成离线。后端同一条判定里也写着这个前置。
    expect(connectivityVerdict([down(registry)])).toBe('partial');
    expect(connectivityVerdict([])).toBe('ok');
  });
});

describe('connectivityCheckModel', () => {
  const NOW = Date.UTC(2026, 7, 30, 14, 11, 34);

  it('把两类分开标注（离线判定只看模型 API，界面上也要看得出来）', () => {
    const model = connectivityCheckModel(
      { rows: [openai, down(registry, '连接超时；如在内网请配置 HTTP_PROXY')], fromHistory: true },
      NOW,
    );
    expect(model.rows[0]).toMatchObject({ kindText: '模型 API', stateText: '连得上 · 351ms' });
    expect(model.rows[1]).toMatchObject({ kindText: '镜像下载源', stateText: '连不上' });
    expect(model.rows[1]?.hint).toContain('HTTP_PROXY');
  });

  it('⭐ 历史结果带上它的时刻 —— 没有时刻就无从判断它是三秒前还是三周前的', () => {
    const model = connectivityCheckModel(
      {
        rows: [openai],
        checkedAt: new Date(NOW - 22 * 60 * 60 * 1000).toISOString(),
        fromHistory: true,
      },
      NOW,
    );
    expect(model.checkedAtText).toContain('22 小时前');
    expect(model.fromHistory).toBe(true);
  });

  it('时刻缺席 ⇒ checkedAtText 缺席（view 据此明说"这份结果没有时刻"，而不是静默省略）', () => {
    const model = connectivityCheckModel({ rows: [openai], fromHistory: true }, NOW);
    expect(model.checkedAtText).toBeUndefined();
  });

  it('一条结果都没有 ⇒ hasResult=false（调用方据此才去自动跑一轮）', () => {
    const model = connectivityCheckModel({ rows: undefined, fromHistory: true }, NOW);
    expect(model.hasResult).toBe(false);
    expect(model.verdictText).toContain('还没有检查过');
  });

  it('离线那句必须说清是物理约束、且平台其余功能可用', () => {
    const model = connectivityCheckModel(
      { rows: [down(openai), down(anthropic)], fromHistory: false },
      NOW,
    );
    expect(model.verdictText).toContain('Agent 将不可用');
    expect(model.verdictText).toContain('物理约束');
    expect(model.verdictText).toContain('其余功能');
  });

  /**
   * ⛔ **三句结论一个 runtime 名字都不许出现。**
   *
   * runtime 是开放注册表（04 §3），第三方可以注册自己的 runtime。上一版这三句里写着
   * 「codex / claude code 必须能访问各自的模型 API」—— 在一台只装了第三方 runtime 的机器上，
   * 被点名的两个一个都不在场，用户读到的是一句与自己无关的话，还会以为平台只支持这两个。
   *
   * ⚠️ 断言写成**扫过全部三句**而不是只看 offline 那句：下一次有人往 `partial`（"模型 API
   * 仍可达，Agent 可用"）里补一句"例如 codex …"时，只盯 offline 的用例是绿的。
   *
   * ⚠️ 这条只管**结论句**。逐行结果里的 `target`（`api.openai.com` 之类）是后端探测到的
   * 网络目标、不是 runtime 名，照常渲染 —— 具体探到了什么由那张表自己说。
   */
  /**
   * ⭐ **`partial` 是两种情形，不是一种** —— 判据只是「模型 API 没有**全部**失败」。
   *
   * ⛔ 上一版这里是一句定值：「部分目标不可达 —— 模型 API 仍可达，Agent 可用」。
   * 一个模型 API 挂掉、另一个还活着时**也是** partial ⇒ 那句话在屏幕上是**假的**：
   * 用户看着 codex 的模型 API 报红，界面却告诉他「模型 API 仍可达，Agent 可用」。
   * 2026-09-09 真机复现（用户质疑「这个怎么判断的，不太合理吧」）。
   *
   * MUTATION: 把 `partialText` 换回定值 ⇒ 本条红（第二个断言）。
   */
  it('⭐ partial：模型 API 挂了一个时，不许说「模型 API 仍可达，Agent 可用」', () => {
    const onlyRegistry = connectivityCheckModel(
      { rows: [openai, anthropic, down(registry)], fromHistory: false },
      NOW,
    ).verdictText;
    const oneModelApi = connectivityCheckModel(
      { rows: [down(openai), anthropic, registry], fromHistory: false },
      NOW,
    ).verdictText;

    // 只有镜像仓库挂：可以说 Agent 可用 —— 这一半没变。
    expect(onlyRegistry).toContain('Agent 可用');
    expect(onlyRegistry).toContain('下载新镜像');

    // 挂的是模型 API：⛔ 不许再说「Agent 可用」，也不许说「模型 API 仍可达」。
    expect(oneModelApi).not.toContain('Agent 可用');
    expect(oneModelApi).not.toContain('模型 API 仍可达');
    expect(oneModelApi).toContain('不算断网');
    expect(oneModelApi).toContain('可能用不了');
  });

  /**
   * ⭐ **超时 ≠ 够不着**，这一位后端一直给着（`timedOut`），是前端把两者压成了「不可达」。
   *
   * 实测同一台机器同一分钟内连 api.openai.com 的 TLS 握手在 **2346 / 2460 / 10245ms**
   * 之间跳，而当时的单目标预算是 3500ms —— 判定是掷硬币，而屏幕上是一个红叉加「不可达」，
   * 下一步还建议去配代理（配了也不解决慢）。
   *
   * MUTATION: `rowModel` 里去掉 `timedOut` 分支 ⇒ 本条红。
   */
  it('⭐ 逐行：timedOut 的那条说「超时未响应」，不说「连不上」', () => {
    const timedOut: ConnectivityResultDto = { ...openai, ok: false, timedOut: true };
    const refused: ConnectivityResultDto = { ...anthropic, ok: false };
    const rows = connectivityCheckModel(
      { rows: [timedOut, refused, registry], fromHistory: false },
      NOW,
    ).rows;

    const slow = rows.find((r) => r.id === 'api.openai.com');
    const dead = rows.find((r) => r.id === 'api.anthropic.com');
    // ⚠️ 「预算」是内部词（那是探测的超时时限），上屏说「超时未响应」；三态区分一格没动。
    expect(slow?.stateText).toBe('超时未响应');
    expect(slow?.timedOut).toBe(true);
    // 镜像:另一条是真的够不着，措辞不能被一起改掉。
    expect(dead?.stateText).toBe('连不上');
    expect(dead?.timedOut).toBeUndefined();
  });

  /** 全部失败都是超时时，结论句也要把「这不等于连不上」说出来。 */
  it('⭐ partial：失败全是超时 ⇒ 结论句必须带上「超时不等于连不上」', () => {
    const text = connectivityCheckModel(
      { rows: [{ ...openai, ok: false, timedOut: true }, anthropic, registry], fromHistory: false },
      NOW,
    ).verdictText;
    expect(text).toContain('超时未响应');
    expect(text).toContain('超时不等于连不上');
    // ⛔ 「预算」这个内部词不许再上屏（换成"这次检查的超时时限"）。
    expect(text).not.toContain('预算');
  });

  it('三句结论都不点名具体 runtime（开放注册表：点名的那句在第三方 runtime 上是错的）', () => {
    const texts = [
      connectivityCheckModel({ rows: [openai, anthropic, registry], fromHistory: false }, NOW),
      connectivityCheckModel({ rows: [openai, down(registry)], fromHistory: false }, NOW),
      connectivityCheckModel({ rows: [down(openai), down(anthropic)], fromHistory: false }, NOW),
    ].map((m) => m.verdictText);

    // 三种 verdict 都真的取到了（否则下面的否定断言可能只是"没跑到那一句"）。
    expect(new Set(texts).size).toBe(3);
    for (const text of texts) {
      expect(text).not.toMatch(/codex|claude|anthropic|openai|gpt/iu);
    }
  });
});

describe('formatCheckedAt', () => {
  it('非法 / 缺席时刻 ⇒ undefined（⛔ 不渲染「NaN 前」）', () => {
    expect(formatCheckedAt(undefined, Date.now())).toBeUndefined();
    expect(formatCheckedAt('', Date.now())).toBeUndefined();
    expect(formatCheckedAt('不是时间', Date.now())).toBeUndefined();
  });
});

describe('connectivityFromDiagnoseDetail（`outbound-network` 帧的 detail 是开放袋）', () => {
  it('形状对得上 ⇒ 取出逐目标结果', () => {
    const rows = connectivityFromDiagnoseDetail({
      results: [
        { target: 'api.openai.com', ok: true, latencyMs: 291, modelApi: true },
        { target: 'localhost:5001', ok: true, latencyMs: 15, modelApi: false },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows?.[1]).toMatchObject({ target: 'localhost:5001', modelApi: false });
  });

  it('⭐ 形状对不上 ⇒ undefined，**不是空数组**', () => {
    // ⚠️ 返回 `[]` 的写法会让 `connectivityVerdict([])` 得到 ok / hasResult=false，
    //    于是一次"读不懂后端"被渲染成"检测过了、没问题"。⇒ 必须是"没有本轮结果"。
    expect(connectivityFromDiagnoseDetail({ results: 'nope' })).toBeUndefined();
    expect(connectivityFromDiagnoseDetail(undefined)).toBeUndefined();
  });
});
