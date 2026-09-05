// 初始化向导（F21-8）的视图模型。wire DTO 一律从 `types/system.ts` 借（那边全是生成物
// 的别名），本文件只写 **view 吃得下的形状**。
//
// ⚠️ 为什么视图模型住在 `types/` 而不是 `lib/`：view 层被 boundaries 禁止 import `lib`
// （`from: 'view', allow: ['view','type','component']`），但可以 import `type`。所以判定、
// 单位换算、文案挑选全部在 `lib/system/` 算完，view 只收一个 model —— 与 F21-5 同一形态。
import type { InitStatusDto, ResourceLevel } from '@/types/system';
import type { PresetImageStep } from '@/types/sse-protocol';

// ————————————————————————————————————————————————————————————————
// Step1 · 出网可达性
// ————————————————————————————————————————————————————————————————

/**
 * 一条出网探测结果的 **wire 形状**。
 *
 * 它出现在两个地方且**逐字段相同**：`GET /api/system/init-status` 的
 * `lastConnectivityCheck[]`，与 `/diagnose` 里 `outbound-network` 那一帧的
 * `detail.results[]`。所以这里从 DTO 上取，不手抄（后端加字段时编译期能看见）。
 */
export type ConnectivityResultDto = NonNullable<InitStatusDto['lastConnectivityCheck']>[number];

/**
 * 整轮出网结论。
 *
 * ⚠️ **`offline` 只由「模型 API」这一类决定**（P21-8 §1 的物理约束：codex / claude code
 * 必须够得着各自的模型 API）。镜像仓库不可达只是「拉不到新镜像」——把它算进离线，会让一台
 * 只是内网镜像站没配好的机器被告知「Agent 将不可用」，而它的 Agent 一直好好的。
 * 这条纪律在后端 `initialization.service.ts::assertOfflineAcknowledged` 里有同一份判定，
 * 两边必须同口径：前端说「不离线」而后端判「离线」时，用户会在 [确认，开始使用] 上收到
 * 一个界面里从没提过的 409。
 */
export type ConnectivityVerdict = 'ok' | 'partial' | 'offline';

export interface ConnectivityRowModel {
  /** = target，用作 React key 与 testid。 */
  id: string;
  target: string;
  ok: boolean;
  /** 原样带上：**离线判定只看它**，UI 也要把两类分开显示。 */
  modelApi: boolean;
  /** `'模型 API'` / `'镜像仓库'`。 */
  kindText: string;
  /** `'可达 · 351ms'` / `'不可达'`。 */
  stateText: string;
  /** 后端给的原因/建议，`ok` 时通常缺席。 */
  hint?: string;
}

export interface ConnectivityCheckModel {
  rows: ConnectivityRowModel[];
  verdict: ConnectivityVerdict;
  /** 一句人话结论，直接上 UI。 */
  verdictText: string;
  /**
   * `'上次检测：2026-08-29 16:11:34（22 小时前）'`。
   *
   * ⚠️ **没有它，历史结果就是一份没有日期的结论**：进向导直接渲染上次检测（§4「不重跑
   * 检测」）本身是对的，但用户无从判断那份结果是三秒前还是三周前的 —— 而「代理昨天配好了」
   * 与「三周前测的，之后网络换过」是完全不同的两件事。
   */
  checkedAtText?: string;
  /** 这份结果来自 `init-status` 的历史（true）还是本轮刚跑的 `/diagnose`（false）。 */
  fromHistory: boolean;
  /** 一条结果都没有（新装且从没跑过检测）⇒ 该自动跑一轮。 */
  hasResult: boolean;
}

// ————————————————————————————————————————————————————————————————
// Step3 · 预制镜像五步链（P21-5 §9A / F21-8 §7A）
// ————————————————————————————————————————————————————————————————

/**
 * 一步在链上的状态。
 *
 * ⚠️ **`info` 是独立一档，不是「弱一点的 fail」**：第 5 步（未 staged）落在它上面，
 * 而那是完全正常的状态——镜像备齐了，只是还没在本机铺开。把它并进 `fail`/`warn` 会让
 * 用户去修一个不需要修的东西，而他能想到的修法是删了重推，那会让情况更糟。
 */
export type PresetImageStepState = 'pass' | 'fail' | 'info' | 'pending';

export interface PresetImageStepModel {
  step: PresetImageStep;
  /** 1..5，界面上写「第 N 步」。 */
  ordinal: number;
  state: PresetImageStepState;
  /** 这一步在检查什么。 */
  label: string;
  /** 后端对这一步的结论（只有走到的那一步才有）。 */
  summary?: string;
  /**
   * **用户下一步要做的事**——五步各不相同（改配置 / 推镜像 / 换成自建那张 / 重启平台 /
   * 只是等一会）。⛔ 这一列是「不许合成一个红灯」的落点，谁把它抽成一句通用文案，
   * 这一步就退化成了一个红灯。
   */
  action?: string;
  /** 可复制的修复命令（优先用后端 `hint`：它带着这台机器上的真实取值）。 */
  fixCommand?: string;
  errorCode?: string;
  /**
   * 这一步**平台能不能自己动手**（2026-09-05 新增，P21-8 §2 ⇒ 新判据）。
   *
   * ⛔ **它存在的意义是让「给命令」退回到它该在的位置。** 此前第 2 步无论如何都渲染
   * `fixCommand`（`docker build && docker push`），而实测里那张镜像的字节就躺在本机
   * docker 库 —— 让用户重新 build 一遍已经有的东西。**平台能做而让用户去敲命令，
   * 那不是指路，是把自己的活派给用户。**
   *
   * ⚠️ 有它时 ⇒ 渲染 [准备镜像] 按钮，**并且不再渲染 `fixCommand`**：两个都给等于
   * 让用户在「点按钮」和「敲命令」之间选，而正确答案只有一个。
   */
  provision?: PresetImageProvisionOffer;
}

/** [准备镜像] 按钮要显示的全部信息 —— ⚠️ **按之前就要说清代价**（P21-8 §2）。 */
export interface PresetImageProvisionOffer {
  /** 从哪搬到哪，原样说出来，用户才对得上。 */
  from: string;
  to: string;
  /** 搬多少字节；给不出就 `null` —— ⛔ 不许编一个数（后端同一条纪律）。 */
  sizeBytes: number | null;
  /** 一句人话：为什么这台机器上能自己搬。 */
  why: string;
}

export interface PresetImageChainModel {
  phase: 'idle' | 'running' | 'done' | 'aborted';
  steps: PresetImageStepModel[];
  /**
   * 五步都过了（含第 5 步的 ℹ️）⇒ 现在就能发起任务。
   * ⚠️ `ready === true` 时**不许**再显示任何「无法发起任务」的话。
   */
  ready: boolean;
  /**
   * 未就绪时那句必须说出口的话（§7A ③）：向导其余步骤放行后功能都是可用的，
   * 只有这一步例外 —— [稍后配置] 之后平台能进、项目能建、**任务建不出来**。
   */
  blockedText?: string;
  abortedText?: string;
}

// ————————————————————————————————————————————————————————————————
// Step4 · 资源池确认
// ————————————————————————————————————————————————————————————————

/** 资源行的档次。`low` 是**向导独有**的一档（P21-8 §2 的偏低阈值），与后端水位三档正交。 */
export interface ResourceConfirmRowModel {
  id: string;
  label: string;
  /** `'10 核'` / `'32 GB'` / `'可用 29.2 GB / 总 926.3 GB'`。 */
  valueText: string;
  /** 后端给的水位档（`GET /api/system/resources`），前端不重算。 */
  level: ResourceLevel;
  /** 命中「资源偏低」阈值（CPU<2 核 / RAM<4GB / 可用磁盘<50GB）。 */
  low: boolean;
  /** 这一行需要多说的一句（磁盘的真实构成等）。 */
  noteText?: string;
}

export interface ResourceConfirmModel {
  rows: ResourceConfirmRowModel[];
  /** 任一行命中偏低阈值。⚠️ **仍可继续**——它是黄色提示，不是门。 */
  low: boolean;
  lowText?: string;
  /** `'调度时预留 15%：RAM 可调度上限 27.2 GB、磁盘 24.8 GB'`。 */
  reservedText: string;
  /**
   * 磁盘要按真实构成说（P21-8 §2，2026-08 实测）：预制镜像约 13GB、boxlite 的 rootfs
   * 缓存实测 31GB、每个 Task 还有一份工作区副本。只报总量会让人以为宽裕。
   */
  diskCompositionText: string;
}

// ————————————————————————————————————————————————————————————————
// 向导骨架
// ————————————————————————————————————————————————————————————————

export type InitStepKey = 'connectivity' | 'proxy' | 'preset-image' | 'resource';

export interface InitStepModel {
  key: InitStepKey;
  /** 1..4。 */
  ordinal: number;
  label: string;
  /** 这一步在本次流程里是否会出现（Step2 只在检测有失败项时展开）。 */
  active: boolean;
  /** 已走过。 */
  done: boolean;
  current: boolean;
}

/** 代理表单的三个字段（`HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`）。 */
export interface ProxyFormValues {
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
}
