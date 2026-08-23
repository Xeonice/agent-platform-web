import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { TaskOutputPaneView } from '@/views/task/TaskOutputPane.view';
import type { TaskStreamItem } from '@/types/taskStream';

const noop = (): void => undefined;

/**
 * 倒计时在生产里是**容器注入的叶子组件**（每秒 tick 只重渲它自己，不穿过输出列表）；
 * story 里不跑 hook，给一个等价的静态节点即可。
 */
const deadline = (label: string, overdue = false) => (
  <span
    className={overdue ? 'text-xs text-amber-400' : 'text-xs text-muted-foreground'}
    data-testid="task-deadline"
  >
    {label}
  </span>
);

const TS = '2026-08-22T01:02:03.000Z';

const FIRST_MESSAGE: TaskStreamItem = {
  id: 'seq:1',
  seq: 1,
  kind: 'message',
  timestamp: TS,
  text: '开始分析仓库结构…',
};

/** 超长行：产品口径是**不折行、横向滚动**（P21-1 §6）。 */
const LONG_LINE: TaskStreamItem = {
  id: 'seq:3',
  seq: 3,
  kind: 'message',
  timestamp: TS,
  text: `patch: ${'-'.repeat(240)}>`,
};

/** 工具调用：`started` 与 `completed` 两帧已按 `id` 合并成**一个**条目。 */
const TOOL_DONE: TaskStreamItem = {
  id: 'tool:c1',
  seq: 2,
  kind: 'tool',
  timestamp: TS,
  text: 'read_file',
  tool: {
    callId: 'c1',
    name: 'read_file',
    status: 'completed',
    input: '{\n  "path": "src/app/page.tsx"\n}',
    output: 'export default function Page() { … }',
    exitCode: 0,
    failed: false,
  },
};

/**
 * 工具**失败**的两个来源（后端刻意分开，因为它们的可信度不同）：
 *  · claude —— `isError: true`，**没有** exitCode（后端不再把布尔合成成 1）；
 *  · codex  —— 真实非零退出码。
 * UI 上都归结为"失败"，退出码只在真有时才显示。
 */
const TOOL_FAILED_CLAUDE: TaskStreamItem = {
  id: 'tool:c3',
  seq: 3,
  kind: 'tool',
  timestamp: TS,
  text: 'Edit',
  tool: {
    callId: 'c3',
    name: 'Edit',
    status: 'completed',
    failed: true,
    output: 'File has not been read yet.',
  },
};

const TOOL_FAILED_CODEX: TaskStreamItem = {
  id: 'tool:c4',
  seq: 4,
  kind: 'tool',
  timestamp: TS,
  text: 'bash',
  tool: { callId: 'c4', name: 'bash', status: 'completed', failed: true, exitCode: 2 },
};

/** 只到了 `started`：结果还没回来，折叠块里明说"会就地补上"。 */
const TOOL_RUNNING: TaskStreamItem = {
  id: 'tool:c2',
  seq: 5,
  kind: 'tool',
  timestamp: TS,
  text: 'bash',
  tool: { callId: 'c2', name: 'bash', status: 'started', input: '{\n  "cmd": "pnpm test"\n}' },
};

const ITEMS: TaskStreamItem[] = [
  FIRST_MESSAGE,
  TOOL_DONE,
  LONG_LINE,
  { id: 'seq:4', seq: 4, kind: 'notice', timestamp: TS, text: '任务执行结束' },
];

const meta: Meta<typeof TaskOutputPaneView> = {
  title: 'Task/OutputPane',
  component: TaskOutputPaneView,
  parameters: { layout: 'fullscreen' },
  args: {
    items: ITEMS,
    connState: 'open',
    attempt: 0,
    caughtUp: true,
    running: false,
    cancelPhase: 'idle',
    onRequestCancel: noop,
    onConfirmCancel: noop,
    onDismissCancel: noop,
    onReconnect: noop,
  },
};
export default meta;

type Story = StoryObj<typeof TaskOutputPaneView>;

/** 常规：正文 / 工具调用（默认折叠）/ 告示三类分开呈现。 */
export const Streaming: Story = {};

/** 空态（任务刚发起，第一批输出还没到）；顶栏出倒计时与 [终止任务]。 */
export const Empty: Story = {
  args: {
    items: [],
    running: true,
    caughtUp: false,
    deadlineSlot: deadline('还剩 1 小时 58 分'),
  },
};

/** 工具失败的两种来源并排（claude 无退出码、codex 有真实退出码）。 */
export const ToolFailed: Story = {
  args: { items: [FIRST_MESSAGE, TOOL_FAILED_CLAUDE, TOOL_FAILED_CODEX] },
};

/** 运行中：工具调用只到了 started（结果未回），顶栏有倒计时与终止入口。 */
export const ToolRunning: Story = {
  args: {
    items: [FIRST_MESSAGE, TOOL_RUNNING],
    running: true,
    deadlineSlot: deadline('还剩 12 分 30 秒'),
  },
};

/** 终止前的二次确认（避免误手掐掉一个跑了 3 小时的任务）。 */
export const CancelConfirming: Story = {
  args: { running: true, cancelPhase: 'confirming', deadlineSlot: deadline('还剩 43 分 2 秒') },
};

/** 正在终止：两阶段强杀在路上，终态仍由 exit 帧宣告。 */
export const Canceling: Story = {
  args: { running: true, cancelPhase: 'canceling', deadlineSlot: deadline('还剩 43 分 2 秒') },
};

/** 已超预算：提示强杀在路上，**不显示负数**。 */
export const DeadlineOverdue: Story = {
  args: {
    running: true,
    deadlineSlot: deadline('已超过硬超时预算，平台正在强制终止…', true),
  },
};

/** 回放中：subscribe 带 fromSeq 后、`caught_up` 到达之前。 */
export const Replaying: Story = {
  args: { caughtUp: false },
};

/** 错误高亮：正文是人话，错误码只作诊断小字（P22 §1）。 */
export const WithError: Story = {
  args: {
    items: [
      ...ITEMS.slice(0, 2),
      {
        id: 'seq:3',
        seq: 3,
        kind: 'error',
        timestamp: TS,
        text: '运行时要求重新授权（oauth-device），任务无法继续',
        code: 'AUTH_REQUIRED',
      },
    ],
  },
};

/** 重连中：重连后按上次序号续订，不重复也不丢。 */
export const Reconnecting: Story = {
  args: { connState: 'reconnecting', attempt: 2, running: true },
};

/** 断开：明说输出停止更新，并给一条出路——重连按 fromSeq 续订，已有输出不清空。 */
export const Disconnected: Story = {
  args: { connState: 'closed', running: true },
};

/**
 * **seq 缺口** —— 后端投递丢了事件。产品口径是显著告警、不静默补拉，
 * 因为"补"只能由后端回放完成（前端零轮询）。
 */
export const SeqGap: Story = {
  args: {
    seqAnomalyMessage: '⚠️ 事件序号出现缺口（期望 3，收到 7）——中间有输出丢失，下方内容不完整。',
    items: [FIRST_MESSAGE, { ...LONG_LINE, id: 'seq:7', seq: 7 }],
  },
};

/**
 * **回放被砍头** —— 只有 `caught_up.firstSeq` 能发现的那一类：
 * 开头缺失看起来跟"这条流本来就从这里开始"一模一样，所以必须显式说出来。
 */
export const ReplayTruncated: Story = {
  args: {
    seqAnomalyMessage:
      '⚠️ 回放被截断：最早只回放到序号 25（期望从 1 起）——开头的输出已不可得，下方不是完整记录。',
    items: [{ ...LONG_LINE, id: 'seq:25', seq: 25 }],
  },
};

/** 终止失败（如任务已结束）：人话就地提示，不裸抛码。 */
export const CancelFailed: Story = {
  args: {
    running: true,
    cancelErrorMessage: '当前状态不允许此操作：任务已结束。',
    deadlineSlot: deadline('还剩 5 分 0 秒'),
  },
};

/** DTO 已是终态、但流上的 `exit` 还没到（WS 连不上时会一直这样）：说"正在取回"，不给终止入口。 */
export const AwaitingOutcome: Story = {
  args: { running: false, awaitingOutcome: true, items: [FIRST_MESSAGE] },
};

/** 输出被上限截断：**明说**省略了多少条，不让用户以为看到的是完整记录。 */
export const Truncated: Story = {
  args: { droppedCount: 12000 },
};

/** 用户往上翻看历史 ⇒ 停止自动跟随，给一个显式的「回到底部」把控制权还回去。 */
export const ScrolledUp: Story = {
  args: { running: true, following: false, deadlineSlot: deadline('还剩 1 小时 2 分') },
};
