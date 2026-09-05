// Step3「预制镜像就绪」的五步链视图模型（F21-8 §7A / P21-5 §9A）。
//
// 这一步是 2026-08-28 实测补的：前七项诊断全绿、向导走完，用户建第一个 Task 时仍然撞墙
// —— `SANDBOX_DEFAULT_IMAGE` 指向的是上游镜像，注册会被血统检查拒。
//
// ⚠️ **三条纪律，每一条都对应一个"看起来完全正常"的错误写法：**
//
//  ① **五步各渲染各的，⛔ 不许合成一个红灯。** 后端一帧只报"链在哪一步停下"，
//     所以这里把它展开成五行：走到之前的步 = ✅ 过了、这一步 = 它的结论、之后 = 未检查。
//     合成一句「镜像不可用」对五种情况一字不差，而用户能做的事一个都不一样
//     （改配置 / 推镜像 / 换成自建那张 / 重启平台 / 只是等一会）。
//
//  ② **第 5 步 `staged` 是 ℹ️，不是失败。** 它是完全正常的状态（镜像备齐了，只是本机
//     还没把 rootfs 铺开），渲染成 ⚠️/❌ 会让用户去"修"一个不需要修的东西——而他能想到的
//     修法是删了重推，那会让情况更糟。⇒ `staged` 这一支恒 `info`，且 `ready` 仍为 true。
//
//  ③ **修复命令优先用后端 `hint`。** 后端那句带着**这台机器上的真实取值**（真的镜像坐标、
//     真的 registry 地址）；本文件的 `FALLBACK_FIX` 只是后端没给 hint 时的兜底形态，
//     ⛔ 不许反过来覆盖后端那一句。
import type { DiagnoseCheckFrame, PresetImageStep } from '@/types/sse-protocol';
import { PRESET_IMAGE_STEPS } from '@/types/sse-protocol';
import type {
  PresetImageChainModel,
  PresetImageStepModel,
  PresetImageStepState,
  PresetImageProvisionOffer,
} from '@/types/init';

/** 这一步在检查什么（P21-5 §9A 那张表的第一列）。 */
const STEP_LABEL: Readonly<Record<PresetImageStep, string>> = {
  config: '配置：`SANDBOX_DEFAULT_IMAGE` 配了没有',
  registry: 'registry：配的那张镜像能不能解析到',
  lineage: '血统：它是不是平台自建的那一张（不是上游镜像）',
  registration: '注册：进没进平台、`validationStatus` 是不是 valid',
  // ⚠️ 措辞里一个"失败/错误"字样都不许有：这一步问的是"铺开没有"，不是"坏没坏"。
  staged: '本机铺开：rootfs 铺好没有（只影响首个任务的耗时）',
};

/**
 * **用户下一步要做的事**——五步各不相同。这是 ⛔「不许合成一个红灯」那条纪律的落点。
 */
const STEP_ACTION: Readonly<Record<PresetImageStep, string>> = {
  config:
    '改配置：把 `SANDBOX_DEFAULT_IMAGE` 指向你自己构建并推上 registry 的那张平台镜像（形如 `<registry>/platform/sandbox:<tag>`）。不配它会回落到内置默认 `alpine:3.20` —— 那里面没有沙箱 API、没有 tmux、没有常驻进程，容器一退端口就空，必炸。',
  registry:
    '把镜像推上去（或把地址改成推过的那个）：registry 里解析不到这张镜像，注册和拉取都无从谈起。',
  // ⚠️ 「注册也会被拒」这句不许省：不说清楚，用户会以为只是少做了一步注册，照着去注册再撞一次墙。
  lineage:
    '换成平台自建的那一张：上游镜像（如 `agent-infra/sandbox`）只是平台镜像的 `FROM`，**拿它去注册也会被血统检查拒** —— 不是少做一步注册。用平台的构建脚本重新构建并推送。',
  registration:
    '重启平台：平台开机会自动播种（把配置里那张镜像注册进来并做验证）。重启后这一步会自己变绿。',
  // ⚠️ 这一句是**预期管理**不是问题报告（§7A ②）。
  staged:
    '不需要任何操作：第一个任务会自动把镜像铺开，需要数分钟（13GB 镜像实测冷启动约 190 秒），之后每次 3–4 秒。',
};

/** 后端没给 `hint` 时的兜底命令形态（③：⛔ 不覆盖后端那一句）。 */
const FALLBACK_FIX: Readonly<Partial<Record<PresetImageStep, string>>> = {
  config: 'SANDBOX_DEFAULT_IMAGE=<registry>/platform/sandbox:<tag>',
  registry: 'docker push <registry>/platform/sandbox:<tag>',
  lineage: 'bash scripts/build-sandbox-image.sh && docker push <registry>/platform/sandbox:<tag>',
};

/** ⚠️ `info` 单独一档 —— 见文件头 ②。谁把它并进 `fail`，第 5 步就变成一个要去修的东西。 */
function stateOfReported(status: DiagnoseCheckFrame['status']): PresetImageStepState {
  if (status === 'ok') return 'pass';
  if (status === 'info') return 'info';
  return 'fail';
}

const IDLE_STEPS: PresetImageStepModel[] = PRESET_IMAGE_STEPS.map((step, i) => ({
  step,
  ordinal: i + 1,
  state: 'pending',
  label: STEP_LABEL[step],
}));

const IDLE: PresetImageChainModel = { phase: 'idle', steps: IDLE_STEPS, ready: false };

/**
 * ⚠️ 这句是向导里**唯一一处「放行了但功能不可用」**（§7A ③）。不说出来，用户会在最挫败
 * 的时机发现——建好项目、选完运行时、填完指令、点下 [发起] 的那一刻。
 */
const BLOCKED_TEXT =
  '预制镜像尚未就绪 —— 可以 [稍后配置] 继续完成初始化，平台能进、项目能建，但**在此之前无法发起任何任务**（新建任务会被直接拒绝）。修好后回系统状态页重跑诊断即可。';

export interface PresetImageChainInput {
  phase: PresetImageChainModel['phase'];
  /** `preset-image` 那一帧；`undefined` = 这一轮还没到（或还没跑）。 */
  frame?: DiagnoseCheckFrame;
}

export function presetImageChainModel(input: PresetImageChainInput): PresetImageChainModel {
  const frame = input.frame;
  if (frame === undefined) {
    return {
      ...IDLE,
      phase: input.phase,
      ...(input.phase === 'aborted'
        ? { abortedText: '镜像检查中断：这一轮没有拿到结论，可点 [重新检测] 重跑。' }
        : {}),
    };
  }

  // ⚠️ 后端**必然**在 preset-image 帧上带 `step`；万一没带（旧版本 / 新形态），把它当作
  //    "链走到最后一步才有结论"处理，而不是丢掉整帧 —— 与 `errorCode` 按开放集合读同一条纪律。
  const reported: PresetImageStep = frame.step ?? 'staged';
  const reportedIndex = PRESET_IMAGE_STEPS.indexOf(reported);
  const reportedState = stateOfReported(frame.status);

  const steps: PresetImageStepModel[] = PRESET_IMAGE_STEPS.map((step, i) => {
    const base = { step, ordinal: i + 1, label: STEP_LABEL[step] };
    // 走到这一步之前的每一步都过了——链是"任一失败即止"的（P21-5 §9A）。
    if (i < reportedIndex) return { ...base, state: 'pass' };
    // ⚠️ 链在前面停住时，后面几步是**没检查**，既不是"通过了"也不是"失败了"。
    //    把它们一起渲染成 ❌ 会让用户以为有五个问题要修，其实只有一个。
    if (i > reportedIndex) return { ...base, state: 'pending' };
    const offer = provisionOfferOf(frame);
    // ⛔ **能自己搬时不再给命令。** 两个都给等于让用户在「点按钮」和「敲命令」之间选，
    //    而正确答案只有一个 —— 而且那条命令里的 `docker build` 会让他重新构建一遍
    //    字节已经在本机的东西（2026-09-05 实测，P21-8 §2 ⇒ 新判据）。
    const fix = offer === undefined ? fixCommandFor(step, frame) : undefined;
    return {
      ...base,
      state: reportedState,
      summary: frame.summary,
      // ⚠️ **通过的那一步不给 action**（实测发现的）：真机上第 5 步是 `ok`（镜像已经铺开了），
      //    而 `STEP_ACTION.staged` 那句「第一个任务会自动把镜像铺开，需要数分钟」照样渲染出来
      //    —— 一条与它上面那句「已在本机铺开，可以立即发起任务」直接打架的预期管理。
      //    `action` 回答的是"接下来要做什么"，而这一步已经没有接下来了。
      ...(reportedState === 'pass' ? {} : { action: STEP_ACTION[step] }),
      ...(fix === undefined ? {} : { fixCommand: fix }),
      ...(offer === undefined ? {} : { provision: offer }),
      ...(frame.errorCode === undefined ? {} : { errorCode: frame.errorCode }),
    };
  });

  // ⚠️ `info`（第 5 步未 staged）**照样是就绪**：镜像备齐了，任务发得出去，只是首个慢几分钟。
  const ready = reportedState !== 'fail';
  return {
    phase: input.phase,
    steps,
    ready,
    ...(ready ? {} : { blockedText: BLOCKED_TEXT }),
  };
}

/**
 * 后端在 `detail.provision` 里带回来的搬运计划 → [准备镜像] 按钮要显示的东西。
 *
 * ⚠️ **`provisionable !== true` 一律返 undefined**，包括字段整个缺席（老后端）与
 * 显式 false 两种。⛔ 不许把「读不到」当成「能搬」—— 那会渲染出一个点了必然失败的按钮，
 * 而用户会以为是自己这台机器的问题。
 */
function provisionOfferOf(frame: DiagnoseCheckFrame): PresetImageProvisionOffer | undefined {
  const d = frame.detail as { provision?: Record<string, unknown> } | undefined;
  const p = d?.provision;
  if (p?.['provisionable'] !== true) return undefined;
  const size = p['sizeBytes'];
  return {
    from: typeof p['from'] === 'string' ? p['from'] : '（未知来源）',
    to: typeof p['to'] === 'string' ? p['to'] : '（未知目标）',
    // ⚠️ 只有真是数字才当数字 —— `null` 是「给不出」的合法取值，要原样传下去让界面画
    //    不确定态；把它读成 0 会显示「0 MB」，那是撒谎。
    sizeBytes: typeof size === 'number' ? size : null,
    why: typeof p['why'] === 'string' ? p['why'] : '',
  };
}

function fixCommandFor(step: PresetImageStep, frame: DiagnoseCheckFrame): string | undefined {
  // ③ 后端 `hint` 优先：它带着这台机器上的真实取值。
  if (frame.hint !== undefined && frame.hint !== '') return frame.hint;
  if (frame.status === 'ok' || frame.status === 'info') return undefined;
  return FALLBACK_FIX[step];
}
