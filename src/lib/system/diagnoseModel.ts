// 诊断卡的 reducer 与视图模型（F21-5 §5A / P21-5 §9A、§9B）。
//
// ⚠️ **四条纪律都在这个文件里落地，且每一条都对应一个"改完看起来完全正常"的写法：**
//
//  ① **清单来自首帧 `start`，不是本地 `DIAGNOSE_CHECK_IDS`。** 各项并行，最快的可能是第 ⑥ 项；
//     "收到一项画一项"会先画出一行孤零零的「WS 回环 ✅」，看起来像诊断只有一项。而用本地
//     常量当清单，则是在后端已经告诉你之后又信了一份可能过期的抄本。
//
//  ② **`check` 帧按 `id` 归位，不按到达顺序追加。** 并行执行下到达顺序 ≠ 展示顺序。
//     用 `push` 的那一版在本机（各项都快）几乎总是碰巧有序，只有在真出问题、某一项慢下来
//     的机器上才乱——也就是唯一有人认真看这张卡的时候。
//
//  ③ **`info` 是 ℹ️ 不是 ⚠️。** 第 ⑧ 项第 5 步（镜像已就绪但未 staged）常态就是它：
//     镜像是好的，只是这台机器还没把 rootfs 铺开，第一个 Task 会慢几分钟。渲染成 ⚠️
//     会让用户去修一个不需要修的东西——而他能想到的"修法"是删了重推，那会让情况更糟。
//     ⇒ 图标查表在这里，`info` 与 `warn` 两行分开写死，谁把它们合并谁当场改到这行。
//
//  ④ **第 ⑧ 项的五步不许合成一条。** 五步的下一步动作完全不同（改配置 / 推镜像 / 换成
//     自建那张 / 重启平台 / 只是等一会），所以 `step` 与 `errorCode` 都原样带到 model 上，
//     并各自配一句"这一步在检查什么"。⛔ 不许在这里把它们归一成一句「镜像不可用」。
//
//  ⑤ **三层分开：`headline` / `detailText` / `nextStep`+`command`。** 旧的 `summary` 既当
//     标题又装证据（长成三行散文），而它渲染在图标同一行；旧的 `hint` 既装散文又装命令，
//     于是「重跑一次看稳不稳定」被塞进等宽框顶着一个 [复制] 按钮。⛔ 不许在这里拼回去。
//
// ⚠️ `errorCode` **按开放集合读**：认得的码补一句上下文，认不出的**照常渲染 `headline`**
// （⛔ 不能因为码不认识就不渲染那一项）。
import { PRESET_IMAGE_CODES, PRESET_IMAGE_STEPS } from '@/types/sse-protocol';
import type {
  DiagnoseCheckFrame,
  DiagnoseCheckId,
  DiagnoseDoneFrame,
  DiagnoseStartFrame,
  DiagnoseStatus,
  PresetImageStep,
} from '@/types/sse-protocol';
import type { DiagnoseRunState, DiagnosticItemModel, DiagnosticsCardModel } from '@/types/system';

/**
 * 预制镜像检查五步各自在**检查什么**（P21-5 §9A 那张表的第二列）。
 *
 * ⚠️ 用词全部按上屏口径：registry ⇒ 镜像仓库，血统 ⇒ 来源，staged ⇒ 下载到本机，
 * `validationStatus: valid` ⇒ 平台检查过。⛔ 界面上一个代码字段名都不许出现。
 */
const PRESET_IMAGE_STEP_NAME: Readonly<Record<PresetImageStep, string>> = {
  // ⛔ 2026-09-07：不再是「配了没有」—— 出厂留空、平台按机器自动选，没配才是正常。
  config: '该用哪张镜像',
  registry: '镜像仓库里有没有',
  lineage: '来源对不对（是不是平台自己构建的那张）',
  registration: '平台有没有检查过、能不能选用',
  // ⚠️ 第 5 步**不是失败**：它只回答「下载到本机没有」。文案里一个「失败/错误」字样都不许有。
  staged: '有没有下载到本机（没下载只影响首个任务的耗时）',
};

/**
 * 「卡在第 N 步（共 5 步）」—— **序号必须自带上下文**（2026-09-11，用户裁决）。
 *
 * ⛔ 上一版恒为「检查链第 3 步 · 血统」。一个孤零零的序号回答不了用户真正在问的
 * 两件事：**前面那几步过了没有**、**一共几步**。而后端一帧只报「链停在哪一步」，
 * 那两件事恰恰是前端算得出、用户自己算不出的部分 —— 与端口那一项「被谁占了」同一条。
 *
 * ⚠️ **「卡住」与「走到」要分开。** 第 5 步 ok/info 时链是走完的，说「卡在第 5 步」
 * 是在一台完全健康的机器上报警。判据是这一步的 status，不是它的序号。
 *
 * ⛔ 这条**不是**「把五步合并成一条」的许可（那条纪律不动）：每一步仍然各报各的
 * `step` 与各自的下一步动作，这里只是把序号说成一句人话。
 */
export function presetImageStepText(step: PresetImageStep, status: DiagnoseStatus): string {
  const index = PRESET_IMAGE_STEPS.indexOf(step);
  const total = PRESET_IMAGE_STEPS.length;
  const blocked = status !== 'ok' && status !== 'info';
  const passed = index > 0 ? `前 ${String(index)} 步已通过，` : '';
  const here = blocked ? '卡在' : '已到';
  return (
    `${passed}${here}第 ${String(index + 1)} 步（共 ${String(total)} 步）` +
    ` · ${PRESET_IMAGE_STEP_NAME[step]}`
  );
}

/** `4231 → '4.2s'`、`820 → '820ms'`。 */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  return `${String(Math.round(ms / 100) / 10)}s`;
}

/** 认得这个码吗（**开放集合**：认不出照常渲染 summary，不丢帧、不吞项）。 */
export function isKnownPresetImageCode(code: string): boolean {
  return (PRESET_IMAGE_CODES as readonly string[]).includes(code);
}

/**
 * 点下 [重新诊断] 的那一刻。
 *
 * ⚠️ **保留上一轮的 `checks` 做占位**（它同样来自服务端的 `start` 帧，不是本地常量）：
 * 否则每次重新诊断，八行会先整体消失再一次性长出来，用户看到的是一次闪烁而不是"重跑"。
 * 首次运行时 `checks` 为空 —— 那时界面上还没有任何服务端说过的清单，只能显示"正在连接"。
 */
export function beginDiagnose(prev: DiagnoseRunState | undefined): DiagnoseRunState {
  return {
    phase: 'running',
    timeoutMs: prev?.timeoutMs ?? 0,
    checks: prev?.checks ?? [],
    results: {},
  };
}

/** 首帧到达：清单与超时预算**以服务端这一份为准**（覆盖上一轮的占位）。 */
export function applyDiagnoseStart(frame: DiagnoseStartFrame): DiagnoseRunState {
  return {
    phase: 'running',
    timeoutMs: frame.timeoutMs,
    checks: frame.checks.map((c) => ({ id: c.id, label: c.label })),
    results: {},
  };
}

/** 逐项结论：**按 `id` 归位**（②）。 */
export function applyDiagnoseCheck(
  state: DiagnoseRunState,
  frame: DiagnoseCheckFrame,
): DiagnoseRunState {
  return { ...state, results: { ...state.results, [frame.id]: frame } };
}

/** 汇总帧 = 整轮结束。 */
export function applyDiagnoseDone(
  state: DiagnoseRunState,
  frame: DiagnoseDoneFrame,
): DiagnoseRunState {
  return { ...state, phase: 'done', done: frame };
}

/**
 * 断流。**已到达项一条不动**（F21-5 §8）——把七项已查出来的结果连同中断一起抹掉，
 * 等于让一次网络抖动没收用户刚拿到的全部信息。
 */
export function markDiagnoseAborted(state: DiagnoseRunState): DiagnoseRunState {
  return { ...state, phase: 'aborted' };
}

const IDLE_MODEL: DiagnosticsCardModel = { phase: 'idle', items: [] };

/**
 * 只有第 ⑤ 项（联网检查）配这句——**数值来自服务端首帧 `start.timeoutMs`**，
 * ⛔ 不许写死字面量秒数（design/prototype.html 那份静态原型里的 `10s` 只是示例数据，
 * 前车之鉴见 `web/src/mocks/handlers.ts` 里 `DIAGNOSE_TIMEOUT_MS` 的那条注释）。
 * `timeoutMs <= 0` 时（还没收到 `start` 帧）不产出——那时候没有配置可读，说了也是编的。
 */
function timeoutTextFor(checkId: DiagnoseCheckId, timeoutMs: number): string | undefined {
  if (checkId !== 'outbound-network' || timeoutMs <= 0) return undefined;
  return `超时时限 ${formatDurationMs(timeoutMs)}`;
}

function itemFor(
  check: { id: DiagnoseCheckId; label: string },
  frame: DiagnoseCheckFrame | undefined,
  timeoutMs: number,
): DiagnosticItemModel {
  const timeoutText = timeoutTextFor(check.id, timeoutMs);
  if (frame === undefined) {
    return {
      id: check.id,
      label: check.label,
      ...(timeoutText === undefined ? {} : { timeoutText }),
    };
  }
  return {
    id: check.id,
    // 标签以**结论帧**为准（两帧的 label 同源，但结论帧是这一项自己最后说的那一次）。
    label: frame.label,
    status: frame.status,
    headline: frame.headline,
    // ⚠️ 三层各归各位：headline 默认可见，detailText / nextStep / command 收进展开层。
    //    ⛔ 不许在这里把它们拼回一句 —— 那正是被拆开的那个字段。
    ...(frame.detailText === undefined ? {} : { detailText: frame.detailText }),
    ...(frame.nextStep === undefined ? {} : { nextStep: frame.nextStep }),
    ...(frame.command === undefined ? {} : { command: frame.command }),
    ...(frame.step === undefined
      ? {}
      : { step: frame.step, stepText: presetImageStepText(frame.step, frame.status) }),
    ...(frame.errorCode === undefined ? {} : { errorCode: frame.errorCode }),
    durationText: formatDurationMs(frame.durationMs),
    ...(timeoutText === undefined ? {} : { timeoutText }),
  };
}

/**
 * 汇总那一行。
 *
 * ⛔ **为零的那几档不写出来。** 全绿时上一版渲染的是「8 项正常 · 0 项提示 · 0 项警告 ·
 * 0 项失败（含超时）」—— 三个零占掉大半句话，而它们对用户的下一个动作没有任何区别。
 * 判据是那条通用的：这个数字看完之后会做的下一件事有区别吗？没有就别占位置。
 *
 * ⚠️ **「含超时」四个字在有失败时不许省**：`failCount` 里混着 `timeout`（后端刻意的 ——
 * 对整轮结论而言「答不上来」与「答坏了」都不是「好的」）。不写出来，用户会拿这个数字
 * 跟逐项图标对不上。⇒ 它跟着 `failCount` 一起出现、一起消失。
 */
function summaryTextOf(done: DiagnoseDoneFrame): string {
  // ⚠️ 各项**并行**，所以整轮 ≈ 最慢那项，不是各项之和。
  const elapsed = `整轮 ${formatDurationMs(done.totalMs)}`;
  const bad = [
    done.infoCount > 0 ? `${String(done.infoCount)} 项提示` : null,
    done.warnCount > 0 ? `${String(done.warnCount)} 项警告` : null,
    done.failCount > 0 ? `${String(done.failCount)} 项失败（含超时）` : null,
  ].filter((x): x is string => x !== null);
  if (bad.length === 0) {
    return `${String(done.okCount)} 项全部正常 · ${elapsed}`;
  }
  return `${String(done.okCount)} 项正常 · ${bad.join(' · ')} · ${elapsed}`;
}

export function diagnosticsCardModel(state: DiagnoseRunState | undefined): DiagnosticsCardModel {
  if (state === undefined) return IDLE_MODEL;
  const items = state.checks.map((check) =>
    itemFor(check, state.results[check.id], state.timeoutMs),
  );
  const arrived = items.filter((i) => i.status !== undefined).length;
  return {
    phase: state.phase,
    items,
    ...(state.done === undefined ? {} : { summaryText: summaryTextOf(state.done) }),
    ...(state.phase === 'aborted'
      ? {
          abortedText:
            items.length === 0
              ? '诊断中断：连接在拿到检查清单之前就断了'
              : `诊断中断：${String(arrived)}/${String(items.length)} 项已返回，其余项没有结论`,
        }
      : {}),
  };
}
