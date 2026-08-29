// 系统状态页（F21-5）与初始化向导（F21-8）共用的类型：**wire DTO 全部是生成物的别名**，
// 视图模型才手写。与 `types/audit.ts` 同一形态、同一理由。
//
// ⚠️ 这里**没有一个手抄的 wire 字段**。后端改契约 → `pnpm generate:api` → 这里编译期报红，
// 且 `pnpm check:api-drift` 管得到。⛔ 谁要是在这里手写一个 `interface ResourcePoolSnapshot`，
// 后端加一个字段时前端会**静默**少一个，dev/MSW 里看着一切正常（14 §2.1）。
//
// ⚠️ 视图模型住在 `types/` 而不是 `lib/`：`view` 层被 boundaries 禁止 import `lib`
// （eslint.config.js `from: 'view', allow: ['view','type','component']`），但可以 import `type`。
// 所以阈值判定、单位换算、文案挑选全部在 `lib/system/` 算完，view 只收一个 model。
import type { components } from '@/types/generated/openapi';
import type {
  DiagnoseCheckFrame,
  DiagnoseCheckId,
  DiagnoseDoneFrame,
  DiagnoseStatus,
  PresetImageStep,
} from '@/types/sse-protocol';

// ————————————————————————————————————————————————————————————————
// wire DTO（六个端点，10 §6.6 / 27）
// ————————————————————————————————————————————————————————————————

/** `GET /api/system/init-status`，也是 `POST /api/system/init` 的 201 响应。 */
export type InitStatusDto = components['schemas']['InitStatusResponseDto'];
/** `POST /api/system/init` 的请求体。 */
export type InitRequestDto = components['schemas']['InitRequestDto'];
/** `GET /api/system/settings` / `PUT /api/system/settings` 的响应。 */
export type SystemSettingsDto = components['schemas']['SystemSettingsResponseDto'];
/** `PUT /api/system/settings` 的请求体（`null` = 清空，缺席 = 不改）。 */
export type UpdateSystemSettingsDto = components['schemas']['UpdateSystemSettingsDto'];
/** `GET /api/system/resources`。 */
export type SystemResourcesDto = components['schemas']['SystemResourcesResponseDto'];
/** `GET /api/system/providers`（⚠️ 与 `GET /api/providers` 是两个端点）。 */
export type SystemProvidersDto = components['schemas']['SystemProvidersResponseDto'];

/** 单个 provider 的健康行。 */
export type ProviderHealthDto = SystemProvidersDto['providers'][number];
/**
 * 三档资源等级——**取自生成物**。
 *
 * ⚠️ 前端**不重算它**。后端 CPU/RAM 用 80/95、磁盘用 75/90（`system-resources.service.ts`
 * 的 `computeLevel` / `diskLevel`，对齐 P21-5 §5 的两行不同口径）。在前端按 F21-5 §6 那句
 * 「三个维度均 <80%」重算一遍，等于把阈值抄成第二份，而且**抄错**：磁盘 78% 后端说 ⚠️、
 * 前端会说 ✅，同一屏上两个数字打架。这里只做一件后端做不了的事——**取最差维度**。
 */
export type ResourceLevel = SystemResourcesDto['cpu']['level'];

// ————————————————————————————————————————————————————————————————
// 视图模型
// ————————————————————————————————————————————————————————————————

/** 一条水位条。`level` 直接来自后端（见 `ResourceLevel` 注释）。 */
export interface ResourceGaugeModel {
  /** `'cpu' | 'ram' | 'disk'`，用作 React key 与 testid。 */
  id: string;
  label: string;
  level: ResourceLevel;
  /** 已四舍五入到 1 位小数，view 直接渲染。 */
  usedPercent: number;
  /** `'4.2 / 8 核'`、`'5.8 / 16 GB'`、`'150 / 200 GB'`。 */
  amountText: string;
}

/** 保留卷占用行（P21-5 §9C）。 */
export interface RetainedVolumeModel {
  count: number;
  level: ResourceLevel;
  /** `'45 GB'`。 */
  sizeText: string;
  /** `'占 DATA_ROOT 的 22.5%'`。 */
  shareText: string;
  /** `'最早的成果还需 6 天清理'` / `'不足 1 天'`；无保留卷时不产出。 */
  countdownText?: string;
  /**
   * 统计被截断（目录太多）。⚠️ 截断了却报一个确切数字，用户清完发现没腾出预期的空间，
   * 此后不会再信这个数字（P21-5 §9C）。
   */
  truncated: boolean;
}

export interface ResourcePoolCardModel {
  gauges: ResourceGaugeModel[];
  /**
   * **取最差维度而非平均**（审计 P1-9）：`{cpu:10%, ram:20%, disk:98%}` 必须是 `critical`
   * ——平均会把它算成健康，而那恰恰是最该拦住新建 Task 的时刻。
   */
  overallLevel: ResourceLevel;
  /** 三档各自一句（「资源充足」/「建议停止部分 Task」/「无法创建新 Task」）。 */
  overallText: string;
  activeTasks: number;
  /** 预留比例只影响调度上限，不影响进度条分母（P21-8 §7）。 */
  reservedPercent: number;
  retained: RetainedVolumeModel;
  /** 磁盘维度告警时才给 [清理保留卷]（停 Task 不释放保留卷，审计 P1-9）。 */
  showCleanupRetained: boolean;
}

/** provider 健康三档 + 「无样本」。 */
export type ProviderHealthLevel = 'ok' | 'warning' | 'error' | 'no-sample';

export interface ProviderRowModel {
  id: string;
  isDefault: boolean;
  level: ProviderHealthLevel;
  /**
   * `'最近 1h 失败率 5%（2/40）'`；**无样本时是「无样本」而不是 0%**
   * ——`recentFailureRate` 在 `sampleSize === 0` 时后端**刻意缺席**（0/0 不是 0%）。
   */
  failureText: string;
  /** 已开启的能力位，`'spawnTty · volumeMount · headlessTask'`。 */
  capabilityText: string;
}

export interface RuntimeRowModel {
  id: string;
  displayName: string;
  vendor: string;
  /** `'凭证已配置'` / `'凭证未配置'`。 */
  credentialText: string;
  credentialConfigured: boolean;
  /** `'oauth · api-key'`。 */
  authMethodsText: string;
}

export interface ProviderStatusCardModel {
  providers: ProviderRowModel[];
  runtimes: RuntimeRowModel[];
  imageSpecs: { id: string; isDefault: boolean }[];
  /** `'最近 1 小时'`。 */
  windowText: string;
}

/** 一行连接状态。`unknown` 是**第三态**，不是「坏的」——见 `ConnectionStatusCardModel`。 */
export type ConnectionState = 'ok' | 'down' | 'unknown';

export interface ConnectionRowModel {
  id: string;
  label: string;
  state: ConnectionState;
  /** 一行人话，直接上 UI。 */
  valueText: string;
  /** 为什么是 `unknown` / `down`；`ok` 时通常不给。 */
  hint?: string;
}

/**
 * 连接状态卡（F21-5 §3）。
 *
 * ⚠️ **`unknown` 与 `down` 必须分开**，与诊断的 `timeout ≠ fail` 是同一条纪律：
 * 「这台机器上这一项测不了」和「它坏了」是两个结论，前者报红就是假警报，而假警报比
 * 不检查更贵（P21-5 §9B 的同款理由）。
 */
export interface ConnectionStatusCardModel {
  rows: ConnectionRowModel[];
}

/** 一项诊断在界面上的样子。 */
export interface DiagnosticItemModel {
  id: DiagnoseCheckId;
  label: string;
  /** `undefined` = 这一项还没回来（⏳ 占位，来自首帧 `start`）。 */
  status?: DiagnoseStatus;
  summary?: string;
  /** 可复制的修复命令 / 配置项。 */
  hint?: string;
  /** 只有第 ⑧ 项有；**五步各渲染各的，不许合成一条**（P21-5 §9A）。 */
  step?: PresetImageStep;
  /** `'检查链第 3 步 · 血统（是不是平台自建的那张）'`；lib 查表，view 直接渲染。 */
  stepText?: string;
  /** 只在预制镜像链出现；**按开放集合读**，认不出的照常渲染 `summary`。 */
  errorCode?: string;
  /** `'1.2s'`；未返回时不产出。 */
  durationText?: string;
}

/** 整轮诊断的阶段。 */
export type DiagnoseRunPhase = 'idle' | 'running' | 'done' | 'aborted';

export interface DiagnosticsCardModel {
  phase: DiagnoseRunPhase;
  /** 恒八项、恒固定顺序；未开始时为空数组（还没有 `start` 帧，别用本地常量顶上）。 */
  items: DiagnosticItemModel[];
  /** `'7 项正常 · 1 项提示 · 0 项警告 · 0 项失败 · 用时 5.0s'`；未收到 `done` 帧时不产出。 */
  summaryText?: string;
  /** 断流时那句「诊断中断」的补充说明。 */
  abortedText?: string;
}

/**
 * 诊断一轮的**缓存形状**——落在 `systemKeys.diagnose()` 里，不是组件局部 state。
 *
 * ⚠️ 这条是产品要求不是实现偏好（F21-5 §4「非阻塞」那一行）：诊断结果要**切走再回来
 * 仍在**。放局部 state 时，用户点完诊断去看一眼镜像管理再回来，八项结果全没了——而他
 * 回来的目的正是照着结果去改配置。
 */
export interface DiagnoseRunState {
  phase: DiagnoseRunPhase;
  /** 单项超时预算，**服务端下发**（前端不自行计时，F21-5 §7.1 ②）。 */
  timeoutMs: number;
  /**
   * 清单与**展示顺序**——来自首帧 `start`。
   *
   * ⛔ 不许用本地 `DIAGNOSE_CHECK_IDS` 顶替它（F21-5 §5A 规矩 1）：那份常量的职责是
   * 给 zod 一个闭集与参与跨仓对账，拿它当渲染清单，等于在后端已经告诉你之后又信了
   * 一份可能过期的本地抄本。
   */
  checks: { id: DiagnoseCheckId; label: string }[];
  /** 按 `id` 归位（到达顺序 ≠ 展示顺序）。 */
  results: Partial<Record<DiagnoseCheckId, DiagnoseCheckFrame>>;
  /** 汇总帧；未收到 = 这一轮还没结束（或中断了）。 */
  done?: DiagnoseDoneFrame;
}
