// Step3 五步链（F21-8 §7A / P21-5 §9A）。
//
// ⭐ **两条证伪用例撑着这个文件：**
//    · 「第 5 步 staged 是 info 不是失败」——把 `info` 并进 `fail` 时它红（页面上只是图标
//      从 ℹ️ 变 ⚠️，其余一切照常，所以肉眼与其它用例都发现不了）；
//    · 「五步的下一步动作两两不同」——把 `STEP_ACTION` 抽成一句通用文案时它红，
//      而那正是「合成一个红灯」这件事在代码里的样子。
import type { PresetImageChainModel, PresetImageProvisionOffer } from '@/types/init';
import { describe, it, expect } from 'vitest';
import { presetImageChainModel, autoStageOffer } from '@/lib/system/presetImageChain';
import type { DiagnoseCheckFrame } from '@/types/sse-protocol';
import { PRESET_IMAGE_STEPS } from '@/types/sse-protocol';

function frame(over: Partial<DiagnoseCheckFrame>): DiagnoseCheckFrame {
  return {
    event: 'check',
    id: 'preset-image',
    label: '预制镜像就绪',
    status: 'ok',
    headline: '预制镜像就绪',
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
        headline: '这张镜像来源不对，用不了',
        detailText: "'ghcr.io/agent-infra/sandbox:latest' 是上游镜像，不是平台自己构建的那张。",
        command: 'bash scripts/build-sandbox-image.sh',
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
        headline: '镜像还没下载到本机',
        detailText: '镜像本身没问题，只是这台机器上还没有它的副本。',
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

  it('⭐ 已通过的那一步**不给 action** —— 否则会渲染出一句和结论打架的话', () => {
    // ⚠️ 真机实测发现的：第 5 步是 `ok`（「已在本机铺开，可以立即发起任务」），
    //    而 action 那句「第一个任务会自动把镜像铺开，需要数分钟」照样渲染 ——
    //    同一行里一句说"现在就能发"、一句说"要等数分钟"。
    const model = presetImageChainModel({
      phase: 'done',
      frame: frame({
        status: 'ok',
        step: 'staged',
        headline: '预制镜像就绪，可以立即发起任务',
        detailText: '平台检查过，而且已经下载到这台机器上。',
      }),
    });
    expect(model.steps[4]?.summary).toContain('可以立即发起任务');
    // ⚠️ 证据下沉到第二层，⛔ 不许与结论拼成一句。
    expect(model.steps[4]?.detail).toContain('已经下载到这台机器上');
    expect(model.steps[4]?.summary).not.toContain('已经下载到这台机器上');
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

  it('⭐ 来源那一步必须说清「手动加进来也会被拒」', () => {
    // ⚠️ 不说清楚，用户会以为只是少做了一步，照着去做再撞一次墙（P21-5 §9A 第 3 步）。
    const model = presetImageChainModel({
      phase: 'done',
      frame: frame({ status: 'fail', step: 'lineage' }),
    });
    const action = model.steps[2]?.action ?? '';
    expect(action).toContain('手动加进来同样会被拒');
    expect(action).toContain('不是少做一步');
    // ⛔ 「血统」是内部词，上屏一个字都不许有（这一步的名字叫「来源」）。
    expect(`${action}${model.steps[2]?.label ?? ''}`).not.toContain('血统');
  });

  it('⛔ 五步的上屏文案里一个 markdown 星号、一个反引号都不许有（没有渲染器）', () => {
    // ⛔ 全链路是纯文本渲染 —— 后端与本文件写下的 `**…**` 会**原样上屏**，用户读到的
    //    是带星号的源代码。这条把五步的标题、动作、兜底命令一起扫一遍。
    // MUTATION: 在任意一句里加回一对 `**` ⇒ 本条红。
    for (const step of PRESET_IMAGE_STEPS) {
      const model = presetImageChainModel({
        phase: 'done',
        frame: frame({ status: 'fail', step }),
      });
      const row = model.steps.find((s) => s.step === step);
      const text = `${row?.label ?? ''}${row?.action ?? ''}`;
      expect(text, `${step}: ${text}`).not.toContain('**');
      expect(text, `${step}: ${text}`).not.toContain('`');
    }
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
    expect(model.steps[0]?.action).toContain('SANDBOX_AIO_IMAGE');
    expect(model.steps[0]?.action).toContain('别动 SANDBOX_DEFAULT_IMAGE');
    expect(model.steps[0]?.fixCommand).toMatch(/SANDBOX_(AIO|BOXLITE)_IMAGE=/);
    expect(model.steps[0]?.fixCommand, '⛔ 修复命令不许是那个会波及两种环境的总开关').not.toMatch(
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

  it('后端 `command` **优先**于本地兜底命令（它带着这台机器上的真实取值）', () => {
    const model = presetImageChainModel({
      phase: 'done',
      frame: frame({
        status: 'fail',
        step: 'registry',
        command: 'docker push localhost:5001/platform/sandbox:v2',
      }),
    });
    expect(model.steps[1]?.fixCommand).toBe('docker push localhost:5001/platform/sandbox:v2');
  });

  it('⛔ `nextStep`（散文）**绝不许**流进 `fixCommand` —— 那个格子是等宽 + [复制]', () => {
    // ⛔ 这正是被拆掉的那个坑：后端的 `hint` 早就演化成散文（「重跑一次看稳不稳定」），
    //    而界面把整个 hint 塞进 `<code>` 顶着一个 [复制] 按钮 —— 复制下来也没地方粘。
    // MUTATION: 让 `fixCommandFor` 回去接 `frame.nextStep` ⇒ 本条红。
    const model = presetImageChainModel({
      phase: 'done',
      frame: frame({
        status: 'fail',
        step: 'registry',
        nextStep: '重跑一次看它稳不稳定：偶发多半只是慢。',
      }),
    });
    expect(model.steps[1]?.fixCommand).not.toContain('重跑一次');
    // 后端没给命令 ⇒ 回落到本地兜底的**命令形态**，⛔ 不是那段散文。
    expect(model.steps[1]?.fixCommand).toBe('docker push <镜像下载源>/platform/sandbox:<标签>');
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

/**
 * ⭐ **自动开始的三条判据**（2026-09-10，用户裁决「进第 3 步就自己铺」）。
 *
 * ⛔ 少任何一条，都会在错的时候开始拉几百 MB：在 `running` 上抢跑、在已经铺好的机器上
 * 白拉一次、或者在平台根本搬不了的机器上开一条必然失败的流。
 *
 * MUTATION: 去掉 `phase !== 'done'` 那道闸 ⇒ 「running 时不抢跑」那条红。
 */
describe('★ autoStageOffer —— 什么时候该自己开始铺', () => {
  const offer: PresetImageProvisionOffer = {
    from: 'ghcr.io/x/y:latest',
    to: '本机 provider 镜像库',
    sizeBytes: null,
    why: '够得着，只是还没铺进本机的 provider 镜像库',
  };
  // ⚠️ 显式标注而不是断言：断言会让「模型少了一个字段」这种改动在这里悄悄通过
  //    （仓库的 `no-unsafe-type-assertion` 正是为这个立的）。
  const staged = (over: Partial<PresetImageChainModel> = {}): PresetImageChainModel => ({
    phase: 'done',
    ready: true,
    steps: [
      { step: 'config', ordinal: 1, state: 'pass', label: '' },
      { step: 'registry', ordinal: 2, state: 'pass', label: '' },
      { step: 'lineage', ordinal: 3, state: 'pass', label: '' },
      { step: 'registration', ordinal: 4, state: 'pass', label: '' },
      { step: 'staged', ordinal: 5, state: 'info', label: '', provision: offer },
    ],
    ...over,
  });

  it('⭐ 有结论 + 第 5 步没过 + 平台搬得了 ⇒ 开始', () => {
    expect(autoStageOffer(staged())).toEqual(offer);
  });

  it('⛔ 这一轮还在跑 ⇒ 不抢跑（结论没出来，判据都还不成立）', () => {
    expect(autoStageOffer(staged({ phase: 'running' }))).toBeUndefined();
  });

  it('⛔ 已经铺好了 ⇒ 不白拉一次', () => {
    const m = staged();
    m.steps[4]!.state = 'pass';
    expect(autoStageOffer(m)).toBeUndefined();
  });

  it('⛔ 平台搬不了（没有 provision 计划）⇒ 不开一条必然失败的流', () => {
    const m = staged();
    delete m.steps[4]!.provision;
    expect(autoStageOffer(m)).toBeUndefined();
  });

  it('⛔ 链在更早的一步就断了（第 5 步 pending）⇒ 不铺，先修那一步', () => {
    const m = staged();
    m.steps[4]!.state = 'pending';
    expect(autoStageOffer(m)).toBeUndefined();
  });
});

/**
 * ⭐ **平台能自己搬时，不许再渲染「等第一个任务」那句**（2026-09-10 真机截图逮到）。
 *
 * ⛔ 屏幕上同时出现过这两句，直接互相否定：
 *   · `action`（前端写死）：「不需要任何操作：第一个任务会自动把镜像铺开」
 *   · `offer.why`（后端）：「平台自己拉一次即可，**不必等到第一个任务**」
 *
 * ⚠️ 这是同一个病的**第二次发作** —— 第一次是写死耗时数字与后端按档给的打架
 * （文件里那条注释记着）。根子一样：**前端写死一句后端已经能分情况说的话**。
 *
 * MUTATION: 把 `offer !== undefined` 从 action 判据里去掉 ⇒ 第一条红。
 */
describe('★ 能自己搬时不给写死的 action', () => {
  const frame = (provision: unknown): DiagnoseCheckFrame => ({
    event: 'check',
    id: 'preset-image',
    label: '预制镜像就绪',
    status: 'info',
    step: 'staged',
    headline: '镜像还没下载到本机',
    durationMs: 1,
    ...(provision === undefined ? {} : { detail: { provision } }),
  });

  it('⭐ 有 provision 计划 ⇒ 第 5 步不带 action（由 offer.why 唯一说话）', () => {
    const m = presetImageChainModel({
      phase: 'done',
      frame: frame({
        provisionable: true,
        from: 'ghcr.io/x/y:latest',
        to: '本机 provider 镜像库',
        sizeBytes: null,
        why: '平台自己拉一次即可',
      }),
    });
    const staged = m.steps.find((s) => s.step === 'staged');
    expect(staged?.provision).toBeDefined();
    expect(staged?.action).toBeUndefined();
  });

  it('搬不了时才给那句「等第一个任务」—— ⛔ 那条分支不许被顺手删掉', () => {
    const m = presetImageChainModel({ phase: 'done', frame: frame(undefined) });
    const staged = m.steps.find((s) => s.step === 'staged');
    expect(staged?.action).toContain('第一个任务');
  });
});
