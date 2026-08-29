// 诊断卡的 reducer 与视图模型（F21-5 §5A / P21-5 §9A、§9B）。
//
// ⚠️ **四条纪律都在这个文件里落地，且每一条都对应一个"改完看起来完全正常"的写法：**
//
//  ① **清单来自首帧 `start`，不是本地 `DIAGNOSE_CHECK_IDS`。** 八项并行，最快的可能是第 ⑥ 项；
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
// ⚠️ `errorCode` **按开放集合读**：认得的码补一句上下文，认不出的**照常渲染 `summary`**
// （⛔ 不能因为码不认识就不渲染那一项）。
import { PRESET_IMAGE_CODES } from '@/types/sse-protocol';
import type {
  DiagnoseCheckFrame,
  DiagnoseCheckId,
  DiagnoseDoneFrame,
  DiagnoseStartFrame,
  PresetImageStep,
} from '@/types/sse-protocol';
import type { DiagnoseRunState, DiagnosticItemModel, DiagnosticsCardModel } from '@/types/system';

/** 预制镜像检查链五步各自在**检查什么**（P21-5 §9A 那张表的第二列）。 */
const PRESET_IMAGE_STEP_TEXT: Readonly<Record<PresetImageStep, string>> = {
  config: '检查链第 1 步 · 配置（SANDBOX_DEFAULT_IMAGE 配了没有）',
  registry: '检查链第 2 步 · registry（配的那张能不能解析到）',
  lineage: '检查链第 3 步 · 血统（是不是平台自建的那张，不是上游镜像）',
  registration: '检查链第 4 步 · 注册（进没进平台、是不是 valid）',
  // ⚠️ 第 5 步**不是失败**：它只回答"本机铺开没有"。文案里一个"失败/错误"字样都不许有。
  staged: '检查链第 5 步 · 本机铺开（未铺开只影响首个任务的耗时）',
};

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

function itemFor(
  check: { id: DiagnoseCheckId; label: string },
  frame: DiagnoseCheckFrame | undefined,
): DiagnosticItemModel {
  if (frame === undefined) return { id: check.id, label: check.label };
  return {
    id: check.id,
    // 标签以**结论帧**为准（两帧的 label 同源，但结论帧是这一项自己最后说的那一次）。
    label: frame.label,
    status: frame.status,
    summary: frame.summary,
    ...(frame.hint === undefined ? {} : { hint: frame.hint }),
    ...(frame.step === undefined
      ? {}
      : { step: frame.step, stepText: PRESET_IMAGE_STEP_TEXT[frame.step] }),
    ...(frame.errorCode === undefined ? {} : { errorCode: frame.errorCode }),
    durationText: formatDurationMs(frame.durationMs),
  };
}

/** `'7 项正常 · 1 项提示 · 0 项警告 · 0 项失败（含超时）· 整轮 5.0s'`。 */
function summaryTextOf(done: DiagnoseDoneFrame): string {
  return (
    `${String(done.okCount)} 项正常 · ${String(done.infoCount)} 项提示 · ` +
    // ⚠️ 「含超时」四个字不许省：`failCount` 里混着 `timeout`（后端刻意的——对整轮结论
    //    而言"答不上来"与"答坏了"都不是"好的"）。不写出来，用户会拿它跟逐项图标对不上。
    `${String(done.warnCount)} 项警告 · ${String(done.failCount)} 项失败（含超时）· ` +
    // ⚠️ 八项**并行**，所以整轮 ≈ 最慢那项，不是各项之和。
    `整轮 ${formatDurationMs(done.totalMs)}`
  );
}

export function diagnosticsCardModel(state: DiagnoseRunState | undefined): DiagnosticsCardModel {
  if (state === undefined) return IDLE_MODEL;
  const items = state.checks.map((check) => itemFor(check, state.results[check.id]));
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
