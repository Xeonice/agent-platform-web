// Step3 五步链（F21-8 §7A / P21-5 §9A）。
//
// ⭐ **两条证伪用例撑着这个文件：**
//    · 「第 5 步 staged 是 info 不是失败」——把 `info` 并进 `fail` 时它红（页面上只是图标
//      从 ℹ️ 变 ⚠️，其余一切照常，所以肉眼与其它用例都发现不了）；
//    · 「五步的下一步动作两两不同」——把 `STEP_ACTION` 抽成一句通用文案时它红，
//      而那正是「合成一个红灯」这件事在代码里的样子。
import { describe, it, expect } from 'vitest';
import { presetImageChainModel } from '@/lib/system/presetImageChain';
import type { DiagnoseCheckFrame } from '@/types/sse-protocol';

function frame(over: Partial<DiagnoseCheckFrame>): DiagnoseCheckFrame {
  return {
    event: 'check',
    id: 'preset-image',
    label: '预制镜像就绪',
    status: 'ok',
    summary: '预制镜像就绪',
    durationMs: 22,
    ...over,
  };
}

describe('五步链的展开', () => {
  it('未跑过 ⇒ 五步全 pending、未就绪', () => {
    const model = presetImageChainModel({ phase: 'idle' });
    expect(model.steps).toHaveLength(5);
    expect(model.steps.every((s) => s.state === 'pending')).toBe(true);
    expect(model.ready).toBe(false);
  });

  it('链在第 3 步（血统）停下 ⇒ 前两步 pass、第 3 步 fail、后两步 **pending 不是 fail**', () => {
    const model = presetImageChainModel({
      phase: 'done',
      frame: frame({
        status: 'fail',
        step: 'lineage',
        errorCode: 'PRESET_IMAGE_NOT_PLATFORM_BUILT',
        summary: "'ghcr.io/agent-infra/sandbox:latest' 是上游镜像，不是平台自建的那张",
        hint: 'bash scripts/build-sandbox-image.sh',
      }),
    });
    expect(model.steps.map((s) => s.state)).toEqual(['pass', 'pass', 'fail', 'pending', 'pending']);
    // ⚠️ 否定断言：把后两步一起标红会让用户以为有三个问题要修，其实只有一个。
    expect(model.steps.filter((s) => s.state === 'fail')).toHaveLength(1);
    expect(model.ready).toBe(false);
    expect(model.steps[2]?.errorCode).toBe('PRESET_IMAGE_NOT_PLATFORM_BUILT');
  });

  it('⭐ 第 5 步 staged + `info` ⇒ 状态是 info（**不是** fail），且**仍然 ready**', () => {
    const model = presetImageChainModel({
      phase: 'done',
      frame: frame({
        status: 'info',
        step: 'staged',
        summary: '预制镜像已就绪，但尚未在本机铺开 —— 首个任务需要数分钟准备镜像',
      }),
    });
    const staged = model.steps[4];
    expect(staged?.state).toBe('info');
    // ⚠️ 这三条否定断言是本文件的核心：渲染成"要修的东西"会让用户去删了重推，情况更糟。
    expect(staged?.state).not.toBe('fail');
    expect(model.ready).toBe(true);
    expect(model.blockedText).toBeUndefined();
    // 文案是**预期管理**不是问题报告：一个"失败/错误"字样都不许有。
    expect(staged?.action).toContain('不需要任何操作');
    expect(staged?.action).not.toContain('失败');
  });

  it('五步全过（staged ok）⇒ 全 pass、ready、无 blockedText', () => {
    const model = presetImageChainModel({
      phase: 'done',
      frame: frame({ status: 'ok', step: 'staged' }),
    });
    expect(model.steps.every((s) => s.state === 'pass')).toBe(true);
    expect(model.ready).toBe(true);
    expect(model.blockedText).toBeUndefined();
  });

  it('⭐ 已通过的那一步**不给 action** —— 否则会渲染出一句和 summary 打架的话', () => {
    // ⚠️ 真机实测发现的：第 5 步是 `ok`（「已在本机铺开，可以立即发起任务」），
    //    而 action 那句「第一个任务会自动把镜像铺开，需要数分钟」照样渲染 ——
    //    同一行里一句说"现在就能发"、一句说"要等数分钟"。
    const model = presetImageChainModel({
      phase: 'done',
      frame: frame({ status: 'ok', step: 'staged', summary: '已注册、已在本机铺开' }),
    });
    expect(model.steps[4]?.summary).toContain('已在本机铺开');
    expect(model.steps[4]?.action).toBeUndefined();
  });
});

describe('⛔ 不许合成一个红灯：每一步都有自己的下一步动作', () => {
  const steps = ['config', 'registry', 'lineage', 'registration', 'staged'] as const;

  it('⭐ 五步的 action 两两不同（抽成一句通用文案时这条红）', () => {
    const actions = steps.map(
      (step) =>
        presetImageChainModel({ phase: 'done', frame: frame({ status: 'fail', step }) }).steps.find(
          (s) => s.step === step,
        )?.action,
    );
    expect(new Set(actions).size).toBe(5);
    expect(actions.every((a) => a !== undefined && a.length > 0)).toBe(true);
  });

  it('⭐ 血统那一步必须说清「注册也会被拒」', () => {
    // ⚠️ 不说清楚，用户会以为只是少做了一步注册，照着去注册再撞一次墙（P21-5 §9A 第 3 步）。
    const model = presetImageChainModel({
      phase: 'done',
      frame: frame({ status: 'fail', step: 'lineage' }),
    });
    expect(model.steps[2]?.action).toContain('注册也会被血统检查拒');
    expect(model.steps[2]?.action).toContain('不是少做一步注册');
  });

  it('⭐ 配置那一步要给**按档**的配置项，且明说别动 SANDBOX_DEFAULT_IMAGE', () => {
    // ⛔ 本条此前断言 `fixCommand` 含 `SANDBOX_DEFAULT_IMAGE=` —— 那是 2026-09-07 之前的
    //    语义。现在出厂留空、平台按宿主档位自动选（darwin ⇒ boxlite，linux ⇒ aio），
    //    **填那个总开关正好让自动选永远失效**，另一档的宿主会拿到不能互换的那张镜像。
    //    ⇒ 走到这一步只剩「第三方 provider 没有发布镜像」一种情形，答案是按档配。
    //
    // MUTATION: 把 `FALLBACK_FIX.config` 改回 `SANDBOX_DEFAULT_IMAGE=…` ⇒ 本条红。
    const model = presetImageChainModel({
      phase: 'done',
      frame: frame({ status: 'fail', step: 'config' }),
    });
    expect(model.steps[0]?.action).toContain('SANDBOX_<档位>_IMAGE');
    expect(model.steps[0]?.action).toContain('别改 `SANDBOX_DEFAULT_IMAGE`');
    expect(model.steps[0]?.fixCommand).toMatch(/SANDBOX_(AIO|BOXLITE)_IMAGE=/);
    expect(model.steps[0]?.fixCommand, '⛔ 修复命令不许是那个会波及两档的总开关').not.toMatch(
      /^SANDBOX_DEFAULT_IMAGE=/,
    );
  });

  it('⭐ 未铺开那一步**不许自己报体积/耗时数字** —— 那是按档的，只有后端知道', () => {
    // ⛔ 它曾写死「13GB 镜像实测冷启动约 190 秒」（aio 档的数字），而 macOS 默认档
    //    boxlite 的镜像压缩后 0.3GB。2026-09-07 实测：这句就渲染在后端那句按档给出的
    //    正确耗时正下方，同屏两个数字互相打架。
    //
    // MUTATION: 把 `STEP_ACTION.staged` 改回带 13GB / 190 秒那句 ⇒ 本条红。
    const model = presetImageChainModel({
      phase: 'done',
      frame: frame({ status: 'info', step: 'staged' }),
    });
    const action = model.steps[4]?.action ?? '';
    expect(action).toContain('不需要任何操作');
    // ⚠️ 禁的是**首次铺开的代价**（体积 / 190 秒 / 数分钟）—— 那一项按档不同，只有后端
    //    知道是哪一档。「之后每次 3–4 秒」是**稳态**耗时，两档一样，留着它是对的。
    for (const banned of ['GB', '190', '数分钟']) {
      expect(action, `耗时由后端按档说,这里出现 '${banned}' 就会与上一行打架`).not.toContain(
        banned,
      );
    }
  });

  it('后端 `hint` **优先**于本地兜底命令（它带着这台机器上的真实取值）', () => {
    const model = presetImageChainModel({
      phase: 'done',
      frame: frame({
        status: 'fail',
        step: 'registry',
        hint: 'docker push localhost:5001/platform/sandbox:v2',
      }),
    });
    expect(model.steps[1]?.fixCommand).toBe('docker push localhost:5001/platform/sandbox:v2');
  });
});

describe('未就绪时那句「放行了但功能不可用」', () => {
  it('⭐ 必须明示「无法发起任何任务」——这是向导里唯一一处放行了但功能不可用', () => {
    const model = presetImageChainModel({
      phase: 'done',
      frame: frame({ status: 'fail', step: 'registration' }),
    });
    expect(model.blockedText).toContain('无法发起任何任务');
    // 同时要说清"能做什么"，否则用户以为整个平台都装坏了。
    expect(model.blockedText).toContain('项目能建');
  });
});
