// 无头 Task 输出流归约（纯函数，可单测）。把 /tasks 的服务端帧折成"可渲染条目 + seq 记账 + 终态"。
// 分层：lib 只依赖 lib/type（07 §4.1）；副作用（连接/重连/订阅）全在 hooks/useTaskStream。
//
// 三条硬纪律写在这里：
//  ① **seq 有缺口就是 bug，不容忍**——中间跳号（gap）、caught_up 声称的上界高于实收
//    （behind-caught-up）、回放开头被砍（truncated，靠 `firstSeq` 才发现）三种都记 `seqAnomaly`，
//    由 UI 显著提示 + hook 上报，绝不"自动补拉"把问题盖过去（本切片零轮询）。
//  ② `session-started` **不进渲染列表**，只把 `ref` 存下来（续接时填进 `resumeFrom`）。
//  ③ `tool-call` 一次调用**两帧**（started/completed），**按 `id` 配对合并成一个条目**——
//    不是两次独立调用。工具名只在 started 上（后端解析器无状态，见 ws-protocol 注释）。
//  ④ **条目有上限**（`MAX_STREAM_ITEMS`）：一个跑 4 小时的任务能刷出几十万条，浏览器扛不住。
//    超出即丢**最早**的那些并记账（`droppedItems`），UI 明说"前 N 条已省略"——
//    静默丢弃比丢弃本身更糟。
import { describeTaskChannelErrorCode } from '@/lib/task/taskOutcome';
import type { RuntimeEvent, TaskClientFrame, TaskServerFrame } from '@/types/ws-protocol';
import type {
  TaskSeqAnomaly,
  TaskStreamItem,
  TaskStreamState,
  TaskToolCall,
} from '@/types/taskStream';

// 形状定义在 types/taskStream.ts（view 层不能 import lib，故 props 形状必须住在 types/）；
// 这里只做归约逻辑。re-export 方便 hooks/containers 就近取用。
export type {
  TaskExit,
  TaskSeqAnomaly,
  TaskStreamItem,
  TaskStreamItemKind,
  TaskStreamState,
  TaskToolCall,
} from '@/types/taskStream';

export type TaskStreamAction =
  | { kind: 'frame'; frame: TaskServerFrame }
  /** 刚发出一次 subscribe：记住这次要的是 `fromSeq` 之后的，caught_up 才能判断有没有被砍头。 */
  | { kind: 'subscribed'; fromSeq: number }
  | { kind: 'reset' };

export function initialTaskStreamState(): TaskStreamState {
  return {
    items: [],
    lastSeq: 0,
    anchored: false,
    caughtUp: false,
    exit: null,
    seqAnomaly: null,
    caughtUpSeq: null,
    channelErrorCode: null,
    subscribedFromSeq: 0,
    droppedItems: 0,
  };
}

/**
 * 订阅帧。`fromSeq` 是**排他**语义（后端权威注释）：「我已经有到 N 为止的了，给我 N 之后的」。
 * 因此直接填"已收到的最大 seq"即可；`0`（刷新后内存为空）省略字段 = 请后端从头回放。
 */
export function buildSubscribeFrame(taskId: string, lastSeq: number): TaskClientFrame {
  return lastSeq > 0
    ? { type: 'subscribe', taskId, fromSeq: lastSeq }
    : { type: 'subscribe', taskId };
}

/** 兜底 JSON 化（只用于工具入参这类**本就是任意结构**的载荷；不再用于猜正文字段）。 */
function jsonish(data: unknown): string {
  if (data === undefined) return '';
  try {
    // data 一定来自 JSON.parse 后的 WS 帧（函数/symbol 不可能出现），故 stringify 必得字符串。
    return JSON.stringify(data, null, 2);
  } catch {
    return '';
  }
}

/** `session-started` 的 ref（唯一不进渲染列表的事件）。 */
function readSessionRef(event: RuntimeEvent): string | undefined {
  return event.type === 'session-started' ? event.data.ref : undefined;
}

/**
 * 工具调用条目的渲染 key。
 *
 * ⚠️ **不能只用 callId**：后端两个解析器都用 `str()` 兜底工具 id，遇到非字符串一律得 `''`，
 * 于是**任何两个缺 id 的工具项都会塌成同一个 key**（`tool:`）——React 报
 * "Encountered two children with the same key"，`<details>` 的展开态还会错位到别的条目上。
 * 加上 `started` 那一帧的 seq 后 key 全局唯一，而合并只在**条目内部**改字段，key 依旧不变。
 */
function toolItemId(callId: string, seq: number): string {
  return `tool:${callId}:${String(seq)}`;
}

/**
 * `tool-call` 的两帧合并。
 *  · `started`   —— 追加一个条目（带名字与入参），key 带上本帧 seq ⇒ 同 id 的第二次调用另起一条；
 *  · `completed` —— 配对到**最近一个还没完成的**同 id 条目并就地补上输出/退出码；找不到
 *    （回放从中间起、错过了 started）就单独追加一条，标为"未知工具"而不是丢掉。
 */
function applyToolCall(
  items: readonly TaskStreamItem[],
  seq: number,
  event: Extract<RuntimeEvent, { type: 'tool-call' }>,
): readonly TaskStreamItem[] {
  const data = event.data;

  if (data.status === 'started') {
    const tool: TaskToolCall = {
      callId: data.id,
      name: data.name,
      status: 'started',
      ...(data.input === undefined ? {} : { input: jsonish(data.input) }),
    };
    return [
      ...items,
      {
        id: toolItemId(data.id, seq),
        seq,
        kind: 'tool',
        timestamp: event.timestamp,
        text: data.name,
        tool,
      },
    ];
  }

  // 配对目标：同 id 中**最后一个仍在运行**的那条。多次同 id 调用时先来先配，
  // 已经完成的条目不会被第二次覆盖。
  let pairIndex = -1;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const tool = items[i]?.tool;
    if (tool?.callId === data.id && tool.status === 'started') {
      pairIndex = i;
      break;
    }
  }

  const completion = {
    status: 'completed' as const,
    ...(data.output === undefined ? {} : { output: data.output }),
    ...(data.exitCode === undefined ? {} : { exitCode: data.exitCode }),
    failed: toolCallFailed(data),
  };

  if (pairIndex < 0) {
    // 孤立的完成半场：名字在 started 那帧，而我们没收到它 ⇒ 不编名字，如实标未知。
    return [
      ...items,
      {
        id: `tool:${data.id}:done:${String(seq)}`,
        seq,
        kind: 'tool',
        timestamp: event.timestamp,
        text: '未知工具（未收到调用开始事件）',
        tool: { callId: data.id, ...completion },
      },
    ];
  }

  return items.map((item, index) =>
    index === pairIndex && item.tool !== undefined
      ? { ...item, tool: { ...item.tool, ...completion } }
      : item,
  );
}

/**
 * 条目上限（环形丢头）。一个跑 4 小时的任务能刷出几十万条，
 * 全量留在内存里既是 O(n) 重渲也是 DOM 节点爆炸。
 *
 * 丢弃**必须记账**：`droppedItems` 让 UI 明说"前 N 条已省略"，
 * 而不是让用户以为自己看到的是完整记录（那和 seq 缺口静默一样不可接受）。
 */
export const MAX_STREAM_ITEMS = 5000;

function capItems(items: readonly TaskStreamItem[]): {
  items: readonly TaskStreamItem[];
  dropped: number;
} {
  const overflow = items.length - MAX_STREAM_ITEMS;
  if (overflow <= 0) return { items, dropped: 0 };
  return { items: items.slice(overflow), dropped: overflow };
}

/**
 * 一次工具调用是否失败。**两个来源各司其职，缺一不可**：
 *  · `isError === true` —— claude 的 `tool_result.is_error`（**只在 true 时出现**）；
 *  · `exitCode` 存在且非 0 —— codex 的**真实**退出码（后端永不合成，所以非 0 就是真非 0）。
 *
 * ⚠️ **不能写成 `exitCode !== 0`**：claude 的成功调用根本没有 `exitCode`，
 * 而 `undefined !== 0` 为真 ⇒ 会把每一次 claude 的成功工具调用都标成失败。
 * 两个都缺席 = **没有报告失败**（不是失败）。
 */
export function toolCallFailed(data: { exitCode?: number; isError?: boolean }): boolean {
  return data.isError === true || (data.exitCode !== undefined && data.exitCode !== 0);
}

/** 把一条 RuntimeEvent 折成渲染条目；`session-started` / `tool-call` 由调用方另行处理。 */
function toItem(seq: number, event: RuntimeEvent): TaskStreamItem | null {
  const base = { id: `seq:${String(seq)}`, seq, timestamp: event.timestamp };

  switch (event.type) {
    case 'session-started':
    case 'tool-call':
      return null; // 前者不渲染，后者走合并路径
    case 'agent-message':
    case 'stdout-chunk':
      // 两者都是"正文"：agent-message 是 agent 的散文，stdout-chunk 是无结构模式的裸字节。
      return { ...base, kind: 'message', text: event.data.text };
    case 'task-complete':
      // 载荷刻意为空（退出码在 /tasks 的 exit 帧上），文案由前端给。
      return { ...base, kind: 'notice', text: '任务执行结束' };
    case 'error':
      // 事件级 error **只有 message 没有码**（码在通道级 error 帧上）⇒ 原样透出后端的句子。
      return { ...base, kind: 'error', text: event.data.message };
    case 'auth-required':
      return {
        ...base,
        kind: 'error',
        text:
          event.data.method === undefined
            ? '运行时要求重新授权，任务无法继续'
            : `运行时要求重新授权（${event.data.method}），任务无法继续`,
        code: 'AUTH_REQUIRED',
      };
  }
}

function applyEventFrame(
  state: TaskStreamState,
  frame: Extract<TaskServerFrame, { type: 'event' }>,
): TaskStreamState {
  // 幂等丢弃已见序号：`fromSeq` 虽是排他语义，但重连窗口内仍可能收到重叠回放；
  // 重复渲染比丢一条更糟，而**跳号**才是真 bug。
  if (state.anchored && frame.seq <= state.lastSeq) return state;

  const expected = state.lastSeq + 1;
  const gap = state.anchored && frame.seq !== expected;
  const seqAnomaly: TaskSeqAnomaly | null = gap
    ? (state.seqAnomaly ?? { kind: 'gap', expected, received: frame.seq })
    : state.seqAnomaly;

  const ref = readSessionRef(frame.event);
  const appended =
    frame.event.type === 'tool-call'
      ? applyToolCall(state.items, frame.seq, frame.event)
      : (() => {
          const item = toItem(frame.seq, frame.event);
          return item === null ? state.items : [...state.items, item];
        })();
  const capped = capItems(appended);

  return {
    ...state,
    // 缺口下仍然把收到的这条渲染出来：报警归报警，已到的数据不该再丢一次。
    items: capped.items,
    droppedItems: state.droppedItems + capped.dropped,
    lastSeq: frame.seq,
    anchored: true,
    ...(ref === undefined ? {} : { sessionRef: ref }),
    seqAnomaly,
  };
}

/**
 * `caught_up` 是回放的**两项体检**：
 *  · `firstSeq > subscribedFromSeq + 1` ⇒ 开头被砍（平台回放不到那么早）——只有这个字段能发现；
 *  · `seq > 已持有的最大序号`            ⇒ 后端说发到了 N，我们只收到 M<N，中间丢了。
 *
 * ⚠️ 第二项**不在这里定论**，只把 `caught_up.seq` 记下来（`caughtUpSeq`），由
 * `selectSeqAnomaly` 在读取时现算。原因：`caught_up` 若先于它宣称的那些事件帧到达，
 * 当场判就是误报；记账 + 读时判则会在后到的事件把 `lastSeq` 追平时自动消解。
 * 反过来，砍头（`truncated`）是**当场就能定论**的事实（`firstSeq` 只描述已经发生的回放），
 * 所以它照旧写进粘性的 `seqAnomaly`。
 */
function applyCaughtUp(
  state: TaskStreamState,
  frame: Extract<TaskServerFrame, { type: 'caught_up' }>,
): TaskStreamState {
  const expectedFirst = state.subscribedFromSeq + 1;
  const truncated = frame.firstSeq > expectedFirst;

  return {
    ...state,
    caughtUp: true,
    caughtUpSeq: frame.seq,
    seqAnomaly:
      state.seqAnomaly ??
      (truncated ? { kind: 'truncated', expected: expectedFirst, received: frame.firstSeq } : null),
  };
}

/**
 * 当前该报的 seq 异常。粘性的那两种（gap / truncated）直接取；
 * `behind-caught-up` 是**读时现算**的活状态——后到的事件把 `lastSeq` 追平后它自己消失。
 *
 * "已持有到哪" = 收到的最大 seq 与本次 `fromSeq` 的较大者。后者不可省：`fromSeq` 是**排他**语义，
 * 它本身就宣称"我已经有到 N 为止的了"，所以一次空回放（firstSeq = seq + 1）不该被算成落后。
 */
export function selectSeqAnomaly(state: TaskStreamState): TaskSeqAnomaly | null {
  if (state.seqAnomaly !== null) return state.seqAnomaly;
  if (state.caughtUpSeq === null) return null;
  const held = Math.max(state.lastSeq, state.subscribedFromSeq);
  return state.caughtUpSeq > held
    ? { kind: 'behind-caught-up', expected: state.caughtUpSeq, received: held }
    : null;
}

/** 服务端帧 → 新状态。纯函数：同样的输入永远同样的输出，可直接喂 useReducer。 */
export function applyTaskServerFrame(
  state: TaskStreamState,
  frame: TaskServerFrame,
): TaskStreamState {
  switch (frame.type) {
    case 'event':
      return applyEventFrame(state, frame);

    case 'caught_up':
      return applyCaughtUp(state, frame);

    case 'exit':
      return {
        ...state,
        exit: {
          status: frame.status,
          // 不做任何"补 0"：缺席就是缺席，呈现层据此按非零退出处理。
          ...(frame.exitCode === undefined ? {} : { exitCode: frame.exitCode }),
        },
      };

    case 'error': {
      // 通道级报错**不等于任务结束**，所以走通道自己的词表；未收录时的兜底也是通道语境的话。
      // key 用"至今追加过的条目总数"而不是 `items.length`：条目会因上限被丢头，
      // 用长度会让 `chan:0` 在丢头后重复出现（又一个重复 key）。
      const appendedSoFar = state.droppedItems + state.items.length;
      const capped = capItems([
        ...state.items,
        {
          id: `chan:${String(appendedSoFar)}`,
          kind: 'error' as const,
          text: describeTaskChannelErrorCode(frame.code) ?? '任务事件通道报错，输出可能不完整。',
          code: frame.code,
        },
      ]);
      return {
        ...state,
        channelErrorCode: frame.code,
        items: capped.items,
        droppedItems: state.droppedItems + capped.dropped,
      };
    }

    case 'pong':
      return state;
  }
}

export function taskStreamReducer(
  state: TaskStreamState,
  action: TaskStreamAction,
): TaskStreamState {
  switch (action.kind) {
    case 'reset':
      return initialTaskStreamState();
    case 'subscribed':
      // 新一轮订阅 ⇒ 上一轮的 caught_up 记账作废（否则旧的 seq 会跟新的 fromSeq 混着判）。
      return { ...state, subscribedFromSeq: action.fromSeq, caughtUp: false, caughtUpSeq: null };
    case 'frame':
      return applyTaskServerFrame(state, action.frame);
  }
}

/**
 * seq 异常的人话。缺口/砍头都意味着"这份记录不完整"，**前端不做本地补拉**（那会把 bug 盖过去），
 * 只把话说明白：这一段输出不完整，请重跑或找后端查。
 */
export function describeSeqAnomaly(anomaly: TaskSeqAnomaly): string {
  switch (anomaly.kind) {
    case 'gap':
      return `⚠️ 事件序号出现缺口（期望 ${String(anomaly.expected)}，收到 ${String(anomaly.received)}）——中间有输出丢失，下方内容不完整。`;
    case 'behind-caught-up':
      return `⚠️ 后端声称已发送到序号 ${String(anomaly.expected)}，但只收到 ${String(anomaly.received)}——有输出在回放中丢失，下方内容不完整。`;
    case 'truncated':
      return `⚠️ 回放被截断：最早只回放到序号 ${String(anomaly.received)}（期望从 ${String(anomaly.expected)} 起）——开头的输出已不可得，下方不是完整记录。`;
  }
}
