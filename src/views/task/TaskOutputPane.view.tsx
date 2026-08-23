// 无头 Task 只读输出面板（P21-1 §6 的产品口径）：**等宽字体、保留换行不自动折行**，
// 超长行**横向滚动**。纯展示、props 驱动、零副作用（滚动跟随的副作用在 hooks/useFollowOutput）。
//
// 三类分开呈现（S6 要求）：
//   · message —— agent 正文（`agent-message` 的散文 + 无结构 runtime 的 `stdout-chunk`）；
//   · tool    —— 工具调用，**默认折叠**（<details>，键盘可达且无需 JS 状态）；
//                ⚠️ 一次调用是两帧（started/completed），已由 lib 按 id 合并成**一个**条目。
//   · error   —— 高亮红字。
//   （notice = 过程告示，弱化灰字，既不混进正文也不冒充错误。）
//
// 无障碍口径：整个输出区是**一个** `role="log"` 活区（隐含 aria-live=polite），
// 逐条 `role="alert"` 会让 20 条错误变成 20 次抢播，读屏被刷屏——那不是"更无障碍"，是更吵。
// 真正需要抢播的只有**一次性的破坏性确认**（终止任务），它单独 role="alert"。
//
// 性能口径（S6 review ⑤ + 本轮 F4）：
//   · 倒计时**不在本组件里算**——每秒 tick 若穿过这里，就是拿 `items.map` 全量重建换一个"分"字。
//     容器把它做成叶子组件从 `deadlineSlot` 传进来，tick 只重渲那一个叶子。
//   · 本组件与单条目都套了 `memo`：容器因别的原因重渲时，输出列表整体跳过。
//   · **列表窗口化**：只渲染 `virtual` 给的那一段，两端用 `aria-hidden` 的占位撑高
//     （实测 5000 条 = 10006 个 DOM 节点，再来一条事件重渲 34ms）。窗口怎么算见 hooks/useVirtualList。
//
// ⚠️ 窗口化带来的一个**必须**处理的后果：窗口外的条目会被卸载，`<details>` 的展开态是 DOM 状态，
// 卸载即丢。所以折叠态被提到**本组件**的 state 里（不是每行自己的 DOM 态）——
// 行卸载再挂回来，展开的仍然是展开的。这也是它没被下放到容器的原因：纯 UI 披露态，
// 与任何副作用/服务端状态无关。
import { memo, useCallback, useState, type ReactNode, type Ref } from 'react';
import type { TaskStreamItem, TaskToolCall, VirtualWindow } from '@/types/taskStream';
import type { ConnState } from '@/types/terminal';
import { Button } from '@/components/ui/button';

/** 终止任务的三态（二次确认，避免误手掐掉一个跑了 3 小时的任务）。 */
export type TaskCancelPhase = 'idle' | 'confirming' | 'canceling';

export interface TaskOutputPaneProps {
  items: readonly TaskStreamItem[];
  /** 因条目上限被丢掉的最早若干条；>0 时必须明说，不许静默截断。 */
  droppedCount?: number;
  connState: ConnState;
  attempt: number;
  /** 回放已追平（之后是直推）。false + 有内容 = 正在回放历史。 */
  caughtUp: boolean;
  /**
   * 终态帧已到 ⇒ 这条流本就该收尾。此时断开不是故障，不再报「输出停止更新」。
   */
  streamComplete?: boolean;
  /**
   * 退避耗尽（`connState==='closed'`）后的唯一出路。
   *
   * ⚠️ **必填，刻意的**（与 ConnectionStatus.view 的 `onManualReconnect` 同一条纪律）：
   * 界面告诉用户"断了"却不给任何办法，是终端上刚修掉的那个死按钮的同一种病。
   * 改必填后，"渲染了断开态却没给出路"由 tsc 在编译期挡住，而不是靠人记得接线。
   *
   * 重连**不清空已有输出**：重连后按 `fromSeq` 续订，只补断开期间缺的那一截。
   */
  onReconnect: () => void;
  /** seq 缺口/砍头的人话；非空即显著告警——**缺口是 bug，不容忍、不静默**。 */
  seqAnomalyMessage?: string;
  /** 任务是否仍在跑（决定"等待输出"空态措辞、倒计时与终止入口的显隐）。 */
  running: boolean;
  /**
   * DTO 已是终态、但流上的 `exit` 帧还没到（WS 连不上时会**一直**这样）。
   * 此时既不能显示倒计时+终止入口（那是在说相反的事实），也不能说"没有产生任何输出"。
   */
  awaitingOutcome?: boolean;
  /** 硬超时倒计时的叶子节点（由容器注入；每秒只重渲它自己）。 */
  deadlineSlot?: ReactNode;

  // —— 终止任务（两阶段强杀）——
  cancelPhase: TaskCancelPhase;
  onRequestCancel: () => void;
  onConfirmCancel: () => void;
  onDismissCancel: () => void;
  cancelErrorMessage?: string;
  /** 「终止任务」按钮的 ref：取消/Esc 之后容器要把焦点还给它。 */
  cancelButtonRef?: Ref<HTMLButtonElement>;

  // —— 滚动跟随（useFollowOutput 提供）——
  scrollRef?: Ref<HTMLDivElement>;
  onScroll?: () => void;
  /** false = 用户已往上翻，此时给「回到底部」入口。 */
  following?: boolean;
  onJumpToBottom?: () => void;

  /**
   * 渲染窗口（hooks/useVirtualList 提供）。**缺省 = 全量渲染**——
   * story 与小列表不必接线，行为与窗口化前完全一致。
   */
  virtual?: VirtualWindow;
}

const KIND_CLASS: Record<TaskStreamItem['kind'], string> = {
  message: 'text-foreground',
  tool: 'text-sky-300',
  error: 'text-red-400',
  notice: 'text-muted-foreground',
};

/**
 * 工具调用的状态注记：运行中 / 完成（失败与否已由 lib 派生成 `failed`）。
 * `isError` 本身不单独露出——它只是"失败"的第二个来源，用户要看的是结论。
 * 退出码只在**真有**的时候显示（codex 给；claude 没有，不编一个）。
 */
function toolStatusLabel(tool: TaskToolCall): string {
  if (tool.status === 'started') return '运行中…';
  const outcome = tool.failed === true ? '失败' : '已完成';
  return tool.exitCode === undefined ? outcome : `${outcome}（退出码 ${String(tool.exitCode)}）`;
}

/** 行的公共标记：`data-vrow` 是 useVirtualList 量高度的锚点（值 = 条目 key）。 */
interface TaskStreamRowProps {
  item: TaskStreamItem;
  /** 折叠块是否展开（态住在列表组件里，行卸载不丢）。 */
  expanded: boolean;
  onToggleTool: (id: string, open: boolean) => void;
}

/**
 * 单条目。`memo` 的收益在"追加一条新输出"这条路上：已有的条目**引用没变** ⇒ 整段跳过重渲。
 * （窗口化之后同时渲染的行只有几十个，但 memo 仍然让"展开某一行"不波及其它行。）
 *
 * ⚠️ 每个 `<li>` 都带 `data-vrow`：没有它 useVirtualList 量不到真实行高，
 * 只能一律按估计值排版 —— 展开一个十几行的工具块就会让滚动条长度与位置一起错。
 */
const TaskStreamRow = memo(function TaskStreamRow({
  item,
  expanded,
  onToggleTool,
}: TaskStreamRowProps) {
  if (item.kind === 'tool' && item.tool !== undefined) {
    const tool = item.tool;
    return (
      <li
        data-vrow={item.id}
        data-kind="tool"
        data-seq={item.seq}
        data-tool-id={tool.callId}
        data-tool-failed={tool.failed === true ? 'true' : 'false'}
        className="pb-1"
      >
        <details
          className="rounded border border-border/60"
          open={expanded}
          onToggle={(e) => {
            onToggleTool(item.id, e.currentTarget.open);
          }}
        >
          <summary
            className={
              tool.failed === true
                ? 'cursor-pointer px-2 py-1 text-red-400'
                : 'cursor-pointer px-2 py-1 text-sky-300'
            }
          >
            🔧 工具调用：{tool.name ?? item.text}
            <span
              className={tool.failed === true ? 'ml-2 text-red-400' : 'ml-2 text-muted-foreground'}
              data-testid="tool-status"
            >
              {toolStatusLabel(tool)}
            </span>
          </summary>
          <div className="px-2 pb-2">
            {tool.input !== undefined && (
              <>
                <p className="text-[10px] text-muted-foreground">入参</p>
                <pre className="overflow-x-auto whitespace-pre text-muted-foreground">
                  {tool.input}
                </pre>
              </>
            )}
            {tool.output !== undefined && (
              <>
                <p className="mt-1 text-[10px] text-muted-foreground">输出</p>
                <pre className="overflow-x-auto whitespace-pre text-muted-foreground">
                  {tool.output}
                </pre>
              </>
            )}
            {tool.status === 'started' && (
              <p className="text-[10px] text-muted-foreground">
                结果还没回来（完成事件到达后会就地补上，不会另起一条）。
              </p>
            )}
          </div>
        </details>
      </li>
    );
  }

  return (
    <li
      data-vrow={item.id}
      data-kind={item.kind}
      data-seq={item.seq}
      data-code={item.code}
      className={`${KIND_CLASS[item.kind]} pb-1`}
    >
      <pre className="overflow-x-auto whitespace-pre">{item.text}</pre>
      {item.kind === 'error' && item.detail !== undefined && item.detail !== '' && (
        <pre className="overflow-x-auto whitespace-pre text-muted-foreground">{item.detail}</pre>
      )}
      {item.kind === 'error' && item.code !== undefined && (
        <span className="text-[10px] text-muted-foreground">诊断码：{item.code}</span>
      )}
    </li>
  );
});

function ConnectionNote({
  connState,
  attempt,
  streamComplete,
  onReconnect,
}: {
  connState: ConnState;
  attempt: number;
  streamComplete: boolean;
  onReconnect: () => void;
}) {
  // 终态已到：这条流该收尾了，断开是正常收场而不是"输出停止更新"。
  if (streamComplete) return null;
  if (connState === 'open') return null;
  if (connState === 'reconnecting') {
    return (
      <p role="status" className="bg-yellow-500/15 px-3 py-1 text-xs text-yellow-300">
        正在重连事件流…（第 {attempt} 次）；重连后会从上次序号继续，不会重复也不会丢
      </p>
    );
  }
  if (connState === 'closed') {
    return (
      <p
        role="alert"
        className="flex items-center gap-2 bg-red-500/15 px-3 py-1 text-xs text-red-300"
      >
        <span>事件流已断开，已停止自动重连；输出停止更新。</span>
        <button
          type="button"
          className="underline"
          onClick={() => {
            onReconnect();
          }}
        >
          重新连接
        </button>
        <span className="text-red-300/70">（已收到的输出会保留，只补缺的那一截）</span>
      </p>
    );
  }
  return (
    <p role="status" className="bg-muted px-3 py-1 text-xs text-muted-foreground">
      正在连接事件流…
    </p>
  );
}

function CancelControl({
  cancelPhase,
  onRequestCancel,
  onConfirmCancel,
  onDismissCancel,
  cancelButtonRef,
}: Pick<
  TaskOutputPaneProps,
  'cancelPhase' | 'onRequestCancel' | 'onConfirmCancel' | 'onDismissCancel' | 'cancelButtonRef'
>) {
  if (cancelPhase === 'canceling') {
    return <span className="text-xs text-muted-foreground">正在终止…（两阶段强杀）</span>;
  }
  if (cancelPhase === 'confirming') {
    return (
      // Esc 撤销：确认按钮 autoFocus ⇒ 焦点就在这个 span 里，keydown 冒得上来。
      <span
        className="flex items-center gap-2 text-xs"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDismissCancel();
        }}
      >
        {/* 不可逆操作的确认必须被读屏播报出来：这里是全页唯一该抢播的一句话。 */}
        <span role="alert" className="text-amber-400">
          终止后本轮无法恢复，确定？
        </span>
        {/* autoFocus：键盘用户点开确认后焦点必须落在确认按钮上（原按钮已被卸载）。
            ⚠️ 确认按钮**不在原按钮的坐标上**（前面多了一段文案），鼠标连点碰不到它——这是刻意的，别改。 */}
        <Button
          autoFocus
          variant="outline"
          size="sm"
          onClick={() => {
            onConfirmCancel();
          }}
        >
          确认终止
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onDismissCancel();
          }}
        >
          取消
        </Button>
      </span>
    );
  }
  return (
    <Button
      ref={cancelButtonRef}
      variant="outline"
      size="sm"
      onClick={() => {
        onRequestCancel();
      }}
    >
      终止任务
    </Button>
  );
}

function TaskOutputPaneViewImpl({
  items,
  droppedCount = 0,
  connState,
  attempt,
  caughtUp,
  streamComplete = false,
  onReconnect,
  seqAnomalyMessage,
  running,
  awaitingOutcome = false,
  deadlineSlot,
  cancelPhase,
  onRequestCancel,
  onConfirmCancel,
  onDismissCancel,
  cancelErrorMessage,
  cancelButtonRef,
  scrollRef,
  onScroll,
  following = true,
  onJumpToBottom,
  virtual,
}: TaskOutputPaneProps) {
  /**
   * 展开着的工具折叠块。**必须住在这一层**：窗口化会卸载窗口外的行，
   * `<details open>` 是 DOM 态、卸载即丢 —— 用户展开一个工具块、又往下看了几百行输出，
   * 回头翻上去发现它自己合上了，这在长任务面板里是天天发生的事。
   */
  const [expandedTools, setExpandedTools] = useState<ReadonlySet<string>>(() => new Set<string>());
  const handleToggleTool = useCallback((id: string, open: boolean): void => {
    setExpandedTools((prev) => {
      if (prev.has(id) === open) return prev; // 无变化不换引用，别把整列表的 memo 打穿
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  // 缺省窗口 = 全量（story / 未接线的调用点行为不变）。
  const start = virtual?.start ?? 0;
  const end = virtual?.end ?? items.length;
  const topPx = virtual?.topPx ?? 0;
  const bottomPx = virtual?.bottomPx ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="task-output-pane">
      <ConnectionNote
        connState={connState}
        attempt={attempt}
        streamComplete={streamComplete}
        onReconnect={onReconnect}
      />

      {running && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1.5">
          {deadlineSlot ?? <span className="text-xs text-muted-foreground">任务运行中</span>}
          <CancelControl
            cancelPhase={cancelPhase}
            onRequestCancel={onRequestCancel}
            onConfirmCancel={onConfirmCancel}
            onDismissCancel={onDismissCancel}
            cancelButtonRef={cancelButtonRef}
          />
        </div>
      )}

      {/* 任务已终结但退出码还没到：说"正在取回"，**不给**倒计时与终止入口。 */}
      {awaitingOutcome && items.length > 0 && (
        <p role="status" className="bg-muted px-3 py-1 text-xs text-muted-foreground">
          任务已结束，正在取回本次结果…
        </p>
      )}

      {cancelErrorMessage !== undefined && cancelErrorMessage !== '' && (
        <p role="alert" className="bg-red-500/15 px-3 py-1 text-xs text-red-300">
          {cancelErrorMessage}
        </p>
      )}

      {seqAnomalyMessage !== undefined && seqAnomalyMessage !== '' && (
        <p role="alert" className="bg-red-500/15 px-3 py-1 text-xs text-red-300">
          {seqAnomalyMessage}
        </p>
      )}

      {droppedCount > 0 && (
        <p
          role="status"
          data-testid="task-output-truncated"
          className="bg-muted px-3 py-1 text-xs text-muted-foreground"
        >
          输出过长：前 {droppedCount} 条已省略，下方只保留最近的部分。
        </p>
      )}

      {!caughtUp && items.length > 0 && (
        <p role="status" className="bg-muted px-3 py-1 text-xs text-muted-foreground">
          正在回放已有输出…
        </p>
      )}

      {/* 保留换行不自动折行 + 横向滚动（P21-1 §6）：whitespace-pre + overflow-x-auto。 */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-auto bg-background p-3 font-mono text-xs"
        data-testid="task-output-scroll"
      >
        {items.length === 0 ? (
          <p className="text-muted-foreground">
            {running
              ? '任务已发起，等待第一批输出…'
              : awaitingOutcome
                ? '任务已结束，正在取回本次结果…'
                : '这个任务没有产生任何输出。'}
          </p>
        ) : (
          // 整段一个活区（role="log" 隐含 aria-live=polite）：逐条 alert 会把读屏刷屏。
          //
          // ⚠️ 行间距用每行的 `pb-1` 而**不是** `gap-1`：占位高度是按量到的 `offsetHeight` 累加的，
          // 而 flex gap 不计入 offsetHeight ⇒ 用 gap 会让滚动条比真实内容短，越往下偏得越多。
          <ul role="log" aria-label="任务输出" className="flex flex-col">
            {/* 两端占位：把窗口外条目的高度"还"给滚动容器，于是 scrollHeight 仍是完整列表的高度。
                aria-hidden ⇒ 它们不进活区、读屏不会念出一段空白。 */}
            {topPx > 0 && (
              <li aria-hidden="true" data-testid="virtual-top-spacer" style={{ height: topPx }} />
            )}
            {items.slice(start, end).map((item) => (
              <TaskStreamRow
                key={item.id}
                item={item}
                expanded={expandedTools.has(item.id)}
                onToggleTool={handleToggleTool}
              />
            ))}
            {bottomPx > 0 && (
              <li
                aria-hidden="true"
                data-testid="virtual-bottom-spacer"
                style={{ height: bottomPx }}
              />
            )}
          </ul>
        )}
      </div>

      {!following && (
        <div className="border-t border-border px-3 py-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onJumpToBottom?.();
            }}
          >
            回到底部（有新输出）
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * `memo`：容器因别的原因重渲（列表 refetch、连接态变化…）时，props 没变就整段跳过。
 * 前提是容器给的回调都是稳定引用——它用 `useCallback` 保证，别在调用处塞内联箭头函数。
 */
export const TaskOutputPaneView = memo(TaskOutputPaneViewImpl);
