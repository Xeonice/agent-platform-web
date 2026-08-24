'use client';
// 无头 Task 主容器（S6）：发起 → 订阅 /tasks 增量渲染 → 终态（退出码 + 产物 + 下载）→ 续接 / 终止。
// 唯一 view↔hooks 粘合点；副作用只在 hook，本层只做编排与本地 UI 态。
//
// 六条语义写在这里：
//  · **零轮询**：进展全部由 /tasks WS 推；REST 只在"挂载 / 发起成功 / 收到 exit"三个时刻各取一次列表。
//    （exit 的那一次由 hook 按 taskId 去重，重连补发的 exit 不会再打一次 REST。）
//  · **刷新恢复**：`GET /api/sandboxes/:id/tasks` 是**权威来源**，persist 的 `selectedTaskId` 只是快路径——
//    它必须过列表校验（任务可能已被清理），不过就回落到列表里仍在跑的那个。
//    输出正文靠 `subscribe(taskId, fromSeq)` 回放，**没有也不需要"全量拉输出"的 REST**。
//  · **终态卡只信 WS**：后端保证迟到订阅者也会收到 `exit` 帧，所以退出码不从 DTO 反推
//    （同一个事实两个真相源，其中一个还是流，是要出错的）。
//  · **但"还在不在跑"要看 DTO**：WS 连不上时 `exit` 永远不会来，而 DTO 里 `status` 明明白白。
//    两个概念分开——见下面 `running` / `awaitingOutcome` 处的注释。
//  · **指令只在局部 state**（安全红线 15 §3.5）：提交即清空，绝不进 store / persist。
//  · **能力位显隐**：provider `capabilities.headlessTask === false` ⇒ 入口置灰 + 原因。
//  · **建完任务之后是详情，不是发起表单**（F21-2 §N.3）：分叉判据是"这个沙箱有没有任务"，
//    不是"沙箱 running 与否"。发起表单必须被 [新任务] 显式打开 —— 但那个入口**一个都不能少**，
//    否则一个沙箱多个任务这条能力就从界面上消失了。
//
// ⚠️ 本容器所有"跨任务会残留"的派生态一律**钉在 taskId 上**，而不是靠 useEffect 去复位：
// 二次确认、终止失败的报错都属于此类。复位型写法依赖时序（上一轮任务自己跑完时确认条已卸载，
// 复位的 effect 根本没机会跑），钉 id 的写法不依赖任何时序。
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTaskStream } from '@/hooks/task/useTaskStream';
import {
  reconcileTaskId,
  useAgentTaskList,
  useCancelAgentTask,
  useRefetchTaskList,
  useRunAgentTask,
  useTaskArtifactDownload,
  useTaskErrorMessage,
} from '@/hooks/task/useAgentTask';
import { useTaskOutcomeView } from '@/hooks/task/useTaskOutcomeView';
import { useTaskDeadline } from '@/hooks/task/useTaskDeadline';
import { useFollowOutput } from '@/hooks/task/useFollowOutput';
import { useVirtualList } from '@/hooks/_shared/useVirtualList';
import { useReturnFocus } from '@/hooks/_shared/useReturnFocus';
import { useReportUnauthorized } from '@/hooks/access/useAccessGate';
import { useAppStore } from '@/stores';
import { HeadlessTaskLauncherView } from '@/views/task/HeadlessTaskLauncher.view';
import { HeadlessTaskDetailView } from '@/views/task/HeadlessTaskDetail.view';
import { TaskOutputPaneView, type TaskCancelPhase } from '@/views/task/TaskOutputPane.view';
import { TaskOutcomeView } from '@/views/task/TaskOutcome.view';
import {
  isTerminalTaskStatus,
  TASK_EXTRA_ARGS,
  TASK_PROMPT_MAX_LENGTH,
  type TaskArtifact,
  type TaskTimeoutMinutes,
} from '@/types/task';
import type { TaskSocketFactory } from '@/types/taskSocket';

/** 默认档位：2 小时（与自动化规则的默认硬超时同口径，P21-7 §4）。 */
const DEFAULT_TIMEOUT: TaskTimeoutMinutes = 120;
const [VERBOSE] = TASK_EXTRA_ARGS;
/** 稳定空数组：避免每次渲染换引用把 useMemo 打穿。 */
const NO_ARTIFACTS: readonly TaskArtifact[] = [];
const RUN_ERROR_FALLBACK = '发起任务失败';
const CANCEL_ERROR_FALLBACK = '终止任务失败，任务可能仍在运行';

/**
 * 硬超时倒计时的**叶子**（S6 review ⑤①）。
 *
 * 存在的唯一理由是把每秒 tick 关在这一个节点里：倒计时住在容器里时，`setNow` 会让整个容器重渲，
 * 输出面板跟着 `items.map` 全量重建——为了把"还剩 1 小时 00 分"改成"59 分"，一个跑 4 小时的任务
 * 要付 14400 次全量重渲。实测 10000 条时一次 tick 61ms。
 */
function TaskDeadlineCountdown({
  startedAt,
  timeoutMinutes,
}: {
  startedAt?: string;
  timeoutMinutes?: number;
}) {
  const deadline = useTaskDeadline({ startedAt, timeoutMinutes }, true);
  return (
    <span
      className={
        deadline?.overdue === true ? 'text-xs text-amber-400' : 'text-xs text-muted-foreground'
      }
      data-testid="task-deadline"
    >
      {deadline?.label ?? '任务运行中'}
    </span>
  );
}

export interface HeadlessTaskContainerProps {
  sandboxId: string;
  /** 任务跑在哪个 runtime 上（POST 路径里的 `:rt`）——取沙箱自己的 runtime，前端不另造选择器。 */
  runtime: string;
  wsBaseUrl: string;
  /**
   * 该沙箱运行档位的 `capabilities.headlessTask`。
   * `null` = registry 里查不到这个档位（还在加载 / 档位已卸载）⇒ 不置灰，以后端 409 为准。
   */
  headlessTaskSupported: boolean | null;
  /** 档位名（仅用于文案）。 */
  providerName?: string;
  /**
   * 测试注入的 /tasks socket 工厂（依赖注入替代模块级 mock，12 §3.1.1）。
   * 生产不传 ⇒ 走真实 socket.io。须是稳定引用。
   */
  socketFactory?: TaskSocketFactory;
}

export function HeadlessTaskContainer({
  sandboxId,
  runtime,
  wsBaseUrl,
  headlessTaskSupported,
  providerName,
  socketFactory,
}: HeadlessTaskContainerProps) {
  // ⚠️ 安全红线（15 §3.5）：指令**只在本容器的局部 state**，绝不写进 store / persist。
  const [prompt, setPrompt] = useState('');
  const [timeoutMinutes, setTimeoutMinutes] = useState<TaskTimeoutMinutes>(DEFAULT_TIMEOUT);
  const [verbose, setVerbose] = useState(false);
  // 续接用的上一轮会话引用（用户点「接着聊」时从终态卡带过来）。
  const [resumeFrom, setResumeFrom] = useState<string | undefined>(undefined);
  /**
   * 正在二次确认终止的是**哪个**任务（不是一个裸 boolean）。
   *
   * 裸 boolean 会跨任务残留，而且是最坏的那种残留：任务1 点了「终止任务」→ 用户改主意没点确认 →
   * 任务1 自己跑完（确认条随 running 一起卸载，boolean 还是 true）→ 发起任务2 →
   * **任务2 的面板首屏就是「确定终止？」**。二次确认存在的唯一价值就是拦误手，
   * 被上一轮的残留态旁路掉之后，它反而变成了一个误杀入口。
   */
  const [confirmingTaskId, setConfirmingTaskId] = useState<string | null>(null);
  // 用户点了「发起全新任务」后，不希望列表把最近那个任务又顶回来 ⇒ 本次会话内压制自动回落。
  const [dismissedTaskId, setDismissedTaskId] = useState<string | null>(null);
  /**
   * 发起表单是不是**被打开着**（F21-2 §N.3）。
   *
   * ⚠️ 这一位是本轮的核心改动。此前没有它：只要沙箱 running，面板主体就是
   * `HeadlessTaskLauncher`（指令 textarea + 发起按钮），**与这个沙箱有没有任务无关** ——
   * 于是建完任务之后，界面主体仍然是"再发起一个"的入口，用户看不到自己刚建的那个任务。
   *
   * 现在分叉的判据是"这个沙箱有没有任务"，而发起表单必须**被显式打开**（[新任务]）。
   * 它是本地 UI 态、不进 store：换沙箱重挂即归零，本来就该是一次性的。
   */
  const [composing, setComposing] = useState(false);

  // persist 的选中位只是**快路径**；权威是下面的列表。
  const persistedTaskId = useAppStore((s) => s.selectedTaskId);
  const setPersistedTaskId = useAppStore((s) => s.setSelectedTaskId);

  const { reportRestError, reportUnauthorized } = useReportUnauthorized();
  const taskList = useAgentTaskList(sandboxId);
  const refetchTasks = useRefetchTaskList(sandboxId);
  const run = useRunAgentTask(sandboxId, runtime);
  const cancel = useCancelAgentTask(sandboxId);
  const runErrorMessage = useTaskErrorMessage(run.error, RUN_ERROR_FALLBACK);
  const cancelErrorMessageRaw = useTaskErrorMessage(cancel.error, CANCEL_ERROR_FALLBACK);

  // 列表校验后的真正跟踪目标。持久 id 不在列表里（已清理）⇒ 自动回落到仍在跑的那个。
  const reconciled = reconcileTaskId(persistedTaskId, taskList.tasks);
  const taskId = reconciled === dismissedTaskId ? null : reconciled;
  const task = taskList.tasks.find((t) => t.id === taskId);

  const onExit = useCallback((): void => {
    // 终态才有完整产物列表 ⇒ 收到 exit 帧再取一次列表。**事件驱动，不是轮询**：
    // hook 保证这个回调在一条流上只触发一次（重连补发的 exit 不再触发）。
    refetchTasks();
  }, [refetchTasks]);

  const { connState, attempt, stream, seqAnomalyMessage, reconnect } = useTaskStream({
    base: wsBaseUrl,
    // 握手期声明归属：后端 `/tasks` 的 subscribe 拿它跟 `task.sandboxId` 对表（同 REST 的寻址规则）。
    sandboxId,
    taskId,
    onUnauthorized: reportUnauthorized,
    onExit,
    ...(socketFactory === undefined ? {} : { socketFactory }),
  });

  // 终态卡与退出码**只来自 WS**：后端保证迟到订阅者在回放后仍会收到 exit 帧。
  const exit = stream.exit;
  /**
   * "还在不在跑"是**另一个**问题，不能只看 `exit === null`。
   *
   * 实测：刷新恢复一个 5 小时前 succeeded / exitCode 0 的任务、而 WS 连不上（反代 / 口令门 /
   * 网络隔离）⇒ exit 永远不来 ⇒ 老写法会一直显示「已超过硬超时预算，平台正在强制终止…」
   * 外加一个终止按钮。那不是"信息暂缺"，那是**给了相反的事实**——DTO 里 `status:'succeeded'`
   * 就躺在内存里。所以：倒计时与终止入口看 DTO 的 status，终态卡仍然只信流。
   */
  const statusTerminal = task !== undefined && isTerminalTaskStatus(task.status);
  const running = task !== undefined && !statusTerminal && exit === null;
  /** DTO 说已终结、流上的 exit 还没到：给「正在取回本次结果…」，而不是倒计时 + 终止按钮。 */
  const awaitingOutcome = statusTerminal && exit === null;
  // sessionRef 两条通道：WS session-started（即时）+ DTO（刷新后回放之前就已可用）。
  const sessionRef = stream.sessionRef ?? task?.sessionRef;
  // 错误码：DTO 的 errorCode 是权威（终态才有）；通道级 error 帧作为即时兜底。
  const errorCode = task?.errorCode ?? stream.channelErrorCode ?? undefined;

  const outcome = useTaskOutcomeView({
    exit,
    ...(errorCode === undefined ? {} : { errorCode }),
    artifacts: task?.artifacts ?? NO_ARTIFACTS,
  });
  const artifactDownload = useTaskArtifactDownload(sandboxId, taskId);
  const follow = useFollowOutput(stream.items.length);
  /**
   * 列表窗口化（F4）。跟随态下窗口锚定末尾、脱离后按 scrollTop 算 —— 两条既有行为
   * （near-bottom 自动跟随 / 「回到底部」）因此不必知道虚拟化存在，见 hooks/useVirtualList 头注释。
   */
  const itemKeys = useMemo(() => stream.items.map((i) => i.id), [stream.items]);
  const virtual = useVirtualList({
    keys: itemKeys,
    scrollRef: follow.scrollRef,
    pinToEnd: follow.following,
  });
  /**
   * 一个滚动事件要喂两个消费者：跟随判定（是否贴底）与窗口重算。
   * 必须 `useCallback` —— 内联箭头函数每次渲染换引用，会把输出面板的 `memo` 打穿，
   * 那正好抵消掉窗口化省下来的东西。
   */
  const followOnScroll = follow.onScroll;
  const virtualOnScroll = virtual.onScroll;
  const handleScroll = useCallback((): void => {
    followOnScroll();
    virtualOnScroll();
  }, [followOnScroll, virtualOnScroll]);

  /**
   * 终止态同样按 taskId 收口。`cancel.variables` 就是 mutate 时传进去的 taskId：
   * 它不等于当前 taskId ⇒ 这是**上一轮**的终止结果，本轮不呈现（⑧ 与 ① 同根）。
   */
  const cancelBelongsToCurrent = taskId !== null && cancel.variables === taskId;
  const cancelPhase: TaskCancelPhase =
    cancelBelongsToCurrent && cancel.isPending
      ? 'canceling'
      : confirmingTaskId !== null && confirmingTaskId === taskId
        ? 'confirming'
        : 'idle';
  const cancelErrorMessage = cancelBelongsToCurrent ? cancelErrorMessageRaw : undefined;

  // 取消/Esc 之后把焦点还给「终止任务」按钮（该按钮在确认期间是被卸载的）。
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  useReturnFocus(cancelPhase === 'confirming', cancelButtonRef);

  const handleSubmit = (): void => {
    const trimmed = prompt.trim();
    // 视图已禁用空/超长提交，这里兜住键盘等旁路触发。
    if (trimmed === '' || Array.from(trimmed).length > TASK_PROMPT_MAX_LENGTH) return;
    if (headlessTaskSupported === false) return;
    // **提交即清空**（安全红线）：值只在这一刻进入请求体，之后前端不再持有。
    setPrompt('');
    run.mutate(
      {
        prompt: trimmed,
        timeoutMinutes,
        ...(resumeFrom === undefined || resumeFrom === '' ? {} : { resumeFrom }),
        ...(verbose ? { extraArgs: [VERBOSE] } : {}),
      },
      {
        onSuccess: (created) => {
          setPersistedTaskId(created.id);
          setDismissedTaskId(null);
          // 发起成功 ⇒ 收起表单，主体转到这条任务的输出面板。
          setComposing(false);
          // 续接引用已被这次请求消费掉，避免下一轮无意中又接同一个会话。
          setResumeFrom(undefined);
          // 新任务还不在缓存的列表里 ⇒ 立刻重取一次（这是列表作为权威来源的代价，很划算）。
          refetchTasks();
        },
        // 启用口令时会 401 → 置锁弹解锁门（11 §3.1）。
        onError: (error) => {
          reportRestError(error);
        },
      },
    );
  };

  const handleRequestCancel = useCallback((): void => {
    setConfirmingTaskId(taskId);
  }, [taskId]);

  const handleDismissCancel = useCallback((): void => {
    setConfirmingTaskId(null);
  }, []);

  const handleConfirmCancel = useCallback((): void => {
    if (taskId === null) return;
    setConfirmingTaskId(null);
    cancel.mutate(taskId, {
      // 202 只表示受理；真正的终态等 /tasks 的 exit 帧（status: 'killed'）。
      onError: (error) => {
        reportRestError(error);
      },
    });
  }, [taskId, cancel, reportRestError]);

  /** 终态 → 用这轮的 sessionRef 接着提新指令（回到发起入口，带上续接标记）。 */
  const handleResume = (): void => {
    if (sessionRef === undefined || sessionRef === '') return;
    setResumeFrom(sessionRef);
    setDismissedTaskId(taskId);
    setPersistedTaskId(null);
    setComposing(true);
    run.reset();
  };

  /** 终态 → 全新一轮（不带 resumeFrom）。 */
  const handleNewTask = (): void => {
    setResumeFrom(undefined);
    setDismissedTaskId(taskId);
    setPersistedTaskId(null);
    setComposing(true);
    run.reset();
  };

  /** 详情/引导态的 [新任务]：打开发起表单（**同一沙箱内的下一个任务**，不是新建沙箱）。 */
  const handleOpenComposer = (): void => {
    setResumeFrom(undefined);
    setComposing(true);
    run.reset();
  };

  /** 收起发起表单，回到详情/引导态（表单是被打开的，就必须有退路）。 */
  const handleCloseComposer = (): void => {
    setResumeFrom(undefined);
    setComposing(false);
    run.reset();
  };

  /** 详情态 [查看输出]：把这条任务重新选为跟踪目标（回到输出面板 + 终态卡）。 */
  const handleOpenTask = (id: string): void => {
    setDismissedTaskId(null);
    setPersistedTaskId(id);
  };

  // 倒计时叶子的元素引用要稳定，否则输出面板的 memo 每次容器重渲都被打穿。
  const deadlineSlot = useMemo(
    () => (
      <TaskDeadlineCountdown startedAt={task?.startedAt} timeoutMinutes={task?.timeoutMinutes} />
    ),
    [task?.startedAt, task?.timeoutMinutes],
  );

  const disabledReason =
    headlessTaskSupported === false
      ? `运行档位「${providerName ?? '当前档位'}」不支持无头任务（headlessTask=false）。请改用支持的档位重建沙箱，或改用交互式终端。`
      : undefined;
  const capabilityUnknownNote =
    headlessTaskSupported === null
      ? '暂时无法确认当前运行档位是否支持无头任务（档位列表未就绪），发起时以后端校验为准。'
      : undefined;

  /**
   * **非发起态**（F21-2 §N.3）：没有正在跟踪的任务，且用户没有主动打开发起表单。
   *
   *  · 这个沙箱一条任务都没有 ⇒ 引导态；
   *  · 有任务（都已终结、或用户刚点了「发起全新任务」之外的路径进来）⇒ **只读详情**
   *    （指令/状态/耗时/产物/退出码）**+ [新任务] 入口**。
   *
   * ⚠️ [新任务] 入口不能省：`GET /api/sandboxes/:id/tasks` 是列表、`selectedTaskId` 记的是
   * "上次盯着哪一个" —— 一个沙箱多个任务是数据模型本来的样子。"建完就没有发起入口"
   * 会把多任务能力从界面上抹掉。
   */
  if (taskId === null && !composing) {
    // 列表按 startedAt 倒序 ⇒ 第一条就是最近的那个。
    const latest = taskList.tasks[0];
    return (
      <HeadlessTaskDetailView
        {...(latest === undefined ? {} : { task: latest })}
        onNewTask={handleOpenComposer}
        {...(latest === undefined
          ? {}
          : {
              onOpenTask: () => {
                handleOpenTask(latest.id);
              },
            })}
        {...(disabledReason === undefined ? {} : { disabledReason })}
        {...(capabilityUnknownNote === undefined ? {} : { capabilityUnknownNote })}
      />
    );
  }

  if (taskId === null) {
    return (
      <HeadlessTaskLauncherView
        prompt={prompt}
        onPromptChange={setPrompt}
        timeoutMinutes={timeoutMinutes}
        onTimeoutChange={setTimeoutMinutes}
        verbose={verbose}
        onVerboseChange={setVerbose}
        onSubmit={handleSubmit}
        submitting={run.isPending}
        disabledReason={disabledReason}
        capabilityUnknownNote={capabilityUnknownNote}
        errorMessage={runErrorMessage}
        resumeFrom={resumeFrom}
        onClearResume={() => {
          setResumeFrom(undefined);
        }}
        // 表单是被 [新任务] 打开的 ⇒ 必须有退路（沙箱里已有任务时尤其明显）。
        onCancel={handleCloseComposer}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      <TaskOutputPaneView
        items={stream.items}
        droppedCount={stream.droppedItems}
        connState={connState}
        attempt={attempt}
        caughtUp={stream.caughtUp}
        streamComplete={exit !== null}
        seqAnomalyMessage={seqAnomalyMessage}
        // 退避耗尽后把决定权交回用户；重连不清空已渲染的输出（按 fromSeq 续订）。
        onReconnect={reconnect}
        running={running}
        awaitingOutcome={awaitingOutcome}
        deadlineSlot={deadlineSlot}
        cancelPhase={cancelPhase}
        onRequestCancel={handleRequestCancel}
        onConfirmCancel={handleConfirmCancel}
        onDismissCancel={handleDismissCancel}
        cancelErrorMessage={cancelErrorMessage}
        cancelButtonRef={cancelButtonRef}
        scrollRef={follow.scrollRef}
        onScroll={handleScroll}
        following={follow.following}
        onJumpToBottom={follow.jumpToBottom}
        virtual={virtual.range}
      />
      {outcome.copy !== null && (
        <TaskOutcomeView
          copy={outcome.copy}
          artifacts={outcome.artifacts}
          onDownload={artifactDownload.download}
          downloadingName={artifactDownload.downloadingName ?? undefined}
          // 只有流式落盘 + 响应带 content-length 时才有值；缺任一个就不显示进度（不猜）。
          downloadProgressLabel={artifactDownload.progressLabel}
          downloadErrorMessage={artifactDownload.error?.message}
          onResume={handleResume}
          sessionRef={sessionRef}
          onNewTask={handleNewTask}
        />
      )}
    </div>
  );
}
