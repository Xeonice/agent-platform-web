// 无头 Task 输出流的**前端自有**类型（28 §5：派生逻辑的类型契约）。
// 与 types/task.ts 的分工：那边是过线的 wire DTO（⏳ 待生成类型替换），这边是前端派生形状。
// 放 types/ 而不是 lib/ 的原因：view 层不许 import lib（07 §4.1 boundaries），
// 但 view 的 props 正是这些形状——类型必须落在两层都能取到的 types/。
import type { TaskStatus } from '@/types/task';

/**
 * 渲染分类。产品要求至少把三类分开呈现（agent 正文 / 工具调用可折叠 / 错误高亮）；
 * `notice` 是第四类"过程告示"（如 task-complete），既不混进正文也不冒充错误。
 */
export type TaskStreamItemKind = 'message' | 'tool' | 'error' | 'notice';

/**
 * 一次工具调用的**合并**视图：`started` 与 `completed` 是两帧，按 `id` 配对成一个条目。
 * 后端刻意只在 `started` 上放 `name`（完成半场拿不到工具名，解析器必须无状态），
 * 所以名字只能从配对里来——收到孤立的 `completed` 时退化为"未知工具"。
 */
export interface TaskToolCall {
  /** 配对键（后端 `data.id`）。 */
  callId: string;
  /** 工具名；只有孤立 completed（错过了 started）时才是 undefined。 */
  name?: string;
  status: 'started' | 'completed';
  /** 入参（已 JSON 化，来自 started）。 */
  input?: string;
  /** 输出（来自 completed）。 */
  output?: string;
  /** 工具自身的**真实**退出码（只有 codex 会给；与任务的 exit 退出码是两回事）。 */
  exitCode?: number;
  /**
   * 这次工具调用是否失败。**派生值**，由 lib/taskStream 按两个来源算好：
   * `isError === true`（claude）**或** `exitCode` 存在且非 0（codex）。
   *
   * ⚠️ 之所以在 lib 里算完再给 view，是因为这条判定有个真陷阱：写成 `exitCode !== 0`
   * 会把**所有 claude 的成功调用**（它们根本没有 exitCode）标成失败。
   * 这种规则只配存在一份，并且要有测试盯着。
   */
  failed?: boolean;
}

export interface TaskStreamItem {
  /** 渲染 key：事件项 `seq:<n>`；通道级错误项 `chan:<n>`（它们不带 seq）。 */
  id: string;
  /** 平台序号（通道级错误项没有）。 */
  seq?: number;
  kind: TaskStreamItemKind;
  timestamp?: string;
  /** 已归一化的可读正文。 */
  text: string;
  /** 错误项的原始码（诊断用；人话由上层按码渲染，P22 §1）。 */
  code?: string;
  /** 错误项的补充明细（可折叠区内容）。 */
  detail?: string;
  /** kind==='tool' 时的合并视图（两帧按 id 配对后的结果）。 */
  tool?: TaskToolCall;
}

/**
 * seq 异常。三种都意味着"这份记录不完整"，都必须说出来而不是静默渲染：
 *  · `gap`            —— 流**中间**跳号（丢事件）；
 *  · `behind-caught-up` —— caught_up 声称的上界高于实收；
 *  · `truncated`      —— 回放**开头**被砍（平台回放不到那么早），靠 `firstSeq` 才能发现。
 */
export interface TaskSeqAnomaly {
  kind: 'gap' | 'behind-caught-up' | 'truncated';
  expected: number;
  received: number;
}

export interface TaskExit {
  status: TaskStatus;
  /** ⚠️ 可能缺席（被信号杀掉没有退出码）——呈现规则见 lib/taskOutcome。 */
  exitCode?: number;
}

export interface TaskStreamState {
  /** 已渲染条目；**有上限**（lib/taskStream `MAX_STREAM_ITEMS`），超出丢最早的。 */
  items: readonly TaskStreamItem[];
  /** 因上限被丢掉的条目数（0 = 完整记录）。非 0 时 UI 必须明说，不许静默截断。 */
  droppedItems: number;
  /** 已收到的最大 seq；0 = 还没收到任何事件。重连/恢复时作为 `fromSeq` 回带。 */
  lastSeq: number;
  /** 是否已锚定首个 seq（首帧之前不知道后端序号基准是 0 还是 1，不能凭空断言缺口）。 */
  anchored: boolean;
  /** 收到 `caught_up` = 回放结束、之后是直推。 */
  caughtUp: boolean;
  /** CLI 自己的会话 id（来自 `session-started`）；续接时填进 `resumeFrom`。 */
  sessionRef?: string;
  exit: TaskExit | null;
  /**
   * **粘性**异常（gap / truncated）：一旦置上就不再清除，整条流都不再可信。
   * `behind-caught-up` **不在**这里——它是读时现算的活状态，见 lib/taskStream `selectSeqAnomaly`。
   */
  seqAnomaly: TaskSeqAnomaly | null;
  /**
   * 最近一次 `caught_up` 宣称"已投递到"的序号；null = 本轮订阅还没收到 caught_up。
   * 只记账不定论：`caught_up` 若先于它宣称的事件帧到达，当场判 behind 就是误报。
   */
  caughtUpSeq: number | null;
  /** 通道级 error 帧的码（`{type:'error', code}`）。 */
  channelErrorCode: string | null;
  /**
   * 本次订阅用的 `fromSeq`（**排他**语义）。`caught_up.firstSeq` 要跟 `fromSeq + 1` 比才能
   * 判断回放有没有被砍头，所以必须记住这次是从哪里要起的。
   */
  subscribedFromSeq: number;
}

/** 终态呈现文案（lib/taskOutcome 产出，view 只吃结果）。 */
export interface TaskOutcomeCopy {
  /** 'success' 只在「status=succeeded 且 exitCode===0」时出现，其余一律 failed 调性。 */
  tone: 'success' | 'failed';
  /** 退出码展示文本：缺席时是人话，**不是 'undefined'**。 */
  exitCodeLabel: string;
  /** true = 退出码缺席，已按非零退出处理。 */
  exitCodeMissing: boolean;
  /** 人话：发生了什么。 */
  title: string;
  /** 现在能做什么 / 为什么会这样（含缺席退出码的解释与错误码人话）。 */
  advice: string;
  /** 原始码（诊断小字；不当正文）。 */
  diagnosticCode?: string;
}

/** 产物列表的展示形状（体积已格式化 —— view 不能 import lib，故格式化在 hook 层完成）。 */
export interface TaskArtifactView {
  name: string;
  /** 已格式化的体积，如 "12.3 KB"。 */
  sizeLabel: string;
  modifiedAt: string;
}
