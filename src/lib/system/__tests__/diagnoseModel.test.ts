// F21-5 §5A 五条规矩 + P21-5 §9A/§9B 的 lib 侧落地。
import { describe, it, expect } from 'vitest';
import {
  applyDiagnoseCheck,
  applyDiagnoseDone,
  applyDiagnoseStart,
  beginDiagnose,
  diagnosticsCardModel,
  formatDurationMs,
  isKnownPresetImageCode,
  markDiagnoseAborted,
} from '@/lib/system/diagnoseModel';
import type { DiagnoseCheckFrame, DiagnoseStartFrame } from '@/types/sse-protocol';

const START: DiagnoseStartFrame = {
  event: 'start',
  checks: [
    { id: 'container-runtime', label: '容器运行时可达' },
    { id: 'port-conflict', label: '端口占用' },
    { id: 'preset-image', label: '预制镜像就绪' },
  ],
  timeoutMs: 5000,
};

function check(over: Partial<DiagnoseCheckFrame> = {}): DiagnoseCheckFrame {
  return {
    event: 'check',
    id: 'container-runtime',
    label: '容器运行时可达',
    status: 'ok',
    summary: 'docker socket 可达',
    durationMs: 142,
    ...over,
  };
}

describe('① 清单来自首帧 start，不是本地常量', () => {
  it('未运行 ⇒ items 为空（此时服务端还没说过清单，⛔ 不许拿 DIAGNOSE_CHECK_IDS 画八行）', () => {
    const model = diagnosticsCardModel(undefined);
    expect(model.items).toEqual([]);
    expect(model.phase).toBe('idle');
  });

  it('start 之后，行数与顺序**完全跟随服务端那一帧**（这里只给三项，就只画三项）', () => {
    const model = diagnosticsCardModel(applyDiagnoseStart(START));
    expect(model.items.map((i) => i.id)).toEqual([
      'container-runtime',
      'port-conflict',
      'preset-image',
    ]);
    // 一项都还没回来 ⇒ 全是 ⏳（`status` 为 undefined）。
    expect(model.items.every((i) => i.status === undefined)).toBe(true);
  });

  it('重跑时沿用上一轮**服务端给过的**清单做占位（否则八行会先整体消失再长出来）', () => {
    const first = applyDiagnoseStart(START);
    const again = beginDiagnose(first);
    expect(again.phase).toBe('running');
    expect(again.checks).toHaveLength(3);
    // ⚠️ 结果清空：上一轮的结论不许留在新一轮的行上。
    expect(again.results).toEqual({});
  });
});

describe('② check 帧按 id 归位，不按到达顺序追加', () => {
  it('⭐ 乱序到达仍按 start 的顺序渲染（并行执行下这是常态，本机却几乎总是碰巧有序）', () => {
    let state = applyDiagnoseStart(START);
    // 到达顺序：③ → ① （第 ② 项还没回来）
    state = applyDiagnoseCheck(
      state,
      check({ id: 'preset-image', label: '预制镜像就绪', status: 'info' }),
    );
    state = applyDiagnoseCheck(state, check({ id: 'container-runtime' }));

    const model = diagnosticsCardModel(state);
    expect(model.items.map((i) => i.id)).toEqual([
      'container-runtime',
      'port-conflict',
      'preset-image',
    ]);
    expect(model.items.map((i) => i.status)).toEqual(['ok', undefined, 'info']);
  });

  it('同一 id 再来一帧 ⇒ 覆盖那一行，不新增一行', () => {
    let state = applyDiagnoseStart(START);
    state = applyDiagnoseCheck(state, check({ status: 'warn' }));
    state = applyDiagnoseCheck(state, check({ status: 'ok' }));
    const model = diagnosticsCardModel(state);
    expect(model.items).toHaveLength(3);
    expect(model.items[0]?.status).toBe('ok');
  });
});

describe('③④ 预制镜像五步：step / errorCode 各自成行，不合成一条', () => {
  it('⭐ `staged` + `info` ⇒ 状态是 info（**不是 warn/fail**），且步骤文案里没有"失败/错误"字样', () => {
    // ⚠️ 这条守的是 P21-5 §9A 第 5 步：镜像是好的，只是本机还没铺开。
    //    渲染成警告会让用户去修一个不需要修的东西，而他能想到的"修法"是删了重推。
    let state = applyDiagnoseStart(START);
    state = applyDiagnoseCheck(
      state,
      check({
        id: 'preset-image',
        label: '预制镜像就绪',
        status: 'info',
        step: 'staged',
        summary: '预制镜像已就绪，但尚未在本机铺开',
      }),
    );
    const item = diagnosticsCardModel(state).items[2];
    expect(item?.status).toBe('info');
    expect(item?.step).toBe('staged');
    expect(item?.stepText).toContain('第 5 步');
    expect(item?.stepText).not.toMatch(/失败|错误/);
    // 第 5 步没有码（四个码只覆盖前四步）。
    expect(item?.errorCode).toBeUndefined();
  });

  it('前四步各有各的 step 文案（⛔ 不许四步共用一句「镜像不可用」）', () => {
    const texts = (['config', 'registry', 'lineage', 'registration'] as const).map((step) => {
      let state = applyDiagnoseStart(START);
      state = applyDiagnoseCheck(
        state,
        check({ id: 'preset-image', label: '预制镜像就绪', status: 'fail', step }),
      );
      return diagnosticsCardModel(state).items[2]?.stepText;
    });
    // 四句互不相同 —— 合成一条时这条当场红。
    expect(new Set(texts).size).toBe(4);
  });

  it('`errorCode` 原样带到 model（含**没见过的**码：开放集合，认不出照常渲染 summary）', () => {
    let state = applyDiagnoseStart(START);
    state = applyDiagnoseCheck(
      state,
      check({
        id: 'preset-image',
        label: '预制镜像就绪',
        status: 'fail',
        errorCode: 'PRESET_IMAGE_SOMETHING_NEW_2027',
        summary: '某个未来的失败',
      }),
    );
    const item = diagnosticsCardModel(state).items[2];
    expect(item?.errorCode).toBe('PRESET_IMAGE_SOMETHING_NEW_2027');
    expect(item?.summary).toBe('某个未来的失败');
    expect(isKnownPresetImageCode('PRESET_IMAGE_SOMETHING_NEW_2027')).toBe(false);
    expect(isKnownPresetImageCode('PRESET_IMAGE_NOT_SEEDED')).toBe(true);
  });
});

describe('§9B 端口占用：summary 与 hint 一字不改地带上去', () => {
  it('⭐ 端口号 · 进程名与 pid · 平台原本要用它做什么，三样都在 model 里', () => {
    const summary = '端口 3000（平台 HTTP/WS 服务）被 com.docke (pid 41235) 占用';
    let state = applyDiagnoseStart(START);
    state = applyDiagnoseCheck(
      state,
      check({
        id: 'port-conflict',
        label: '端口占用',
        status: 'fail',
        summary,
        hint: 'lsof -nP -iTCP:3000 -sTCP:LISTEN',
      }),
    );
    const item = diagnosticsCardModel(state).items[1];
    // ⚠️ 不许在 lib 里"归纳"成「端口被占用」：那句话对每一种占用一字不差，
    //    而用户下一步要做的事完全取决于占它的是什么。
    expect(item?.summary).toBe(summary);
    expect(item?.summary).toContain('3000');
    expect(item?.summary).toContain('com.docke');
    expect(item?.summary).toContain('pid 41235');
    expect(item?.hint).toBe('lsof -nP -iTCP:3000 -sTCP:LISTEN');
  });
});

describe('done 汇总与断流', () => {
  it('汇总里点明 failCount **含超时**（不写出来会与逐项图标对不上）', () => {
    let state = applyDiagnoseStart(START);
    state = applyDiagnoseDone(state, {
      event: 'done',
      okCount: 5,
      infoCount: 1,
      warnCount: 1,
      failCount: 1,
      totalMs: 5012,
    });
    const model = diagnosticsCardModel(state);
    expect(model.phase).toBe('done');
    expect(model.summaryText).toContain('1 项失败（含超时）');
    expect(model.summaryText).toContain('整轮 5s');
    expect(model.abortedText).toBeUndefined();
  });

  it('⭐ 断流 ⇒ 已到达项**一条不动**，只多一句「诊断中断 N/M」', () => {
    let state = applyDiagnoseStart(START);
    state = applyDiagnoseCheck(state, check({}));
    state = markDiagnoseAborted(state);

    const model = diagnosticsCardModel(state);
    expect(model.phase).toBe('aborted');
    // ⚠️ 否定断言是关键：把 `markDiagnoseAborted` 写成"清空 results"之后，
    //    「诊断中断」那句照样渲染，只有这一条会红。
    expect(model.items[0]?.status).toBe('ok');
    expect(model.items[0]?.summary).toBe('docker socket 可达');
    expect(model.abortedText).toContain('1/3');
  });

  it('连清单都没拿到就断了 ⇒ 说的是另一句（用户此时什么结论都没有）', () => {
    const model = diagnosticsCardModel(markDiagnoseAborted(beginDiagnose(undefined)));
    expect(model.abortedText).toContain('拿到检查清单之前');
    expect(model.abortedText).not.toContain('/');
  });
});

describe('formatDurationMs', () => {
  it('4231 → 4.2s；820 → 820ms', () => {
    expect(formatDurationMs(4231)).toBe('4.2s');
    expect(formatDurationMs(820)).toBe('820ms');
  });
});
