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
    expect(model.rows[0]).toMatchObject({ kindText: '模型 API', stateText: '可达 · 351ms' });
    expect(model.rows[1]).toMatchObject({ kindText: '镜像仓库', stateText: '不可达' });
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
    expect(model.verdictText).toContain('尚未检测');
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
