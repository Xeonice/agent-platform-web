// SYNC WITH shared/10 §7.4 — 修改需双端确认
// WS 帧类型的前端权威副本（zod schema 为运行时校验唯一源）。
// 三个通道判别键不同：/terminal 用 `type`（字节流帧）、/events 用 `event`（业务投影）、
// /tasks 用 `type`（S6 无头 Task，见文件末尾）——刻意区分防误 parse（10 §7.4）。
import { z } from 'zod';
import type { TaskStatus } from '@/types/task';

/**
 * 任务状态的**运行时**闭集。值来自生成类型（`AgentTaskResponseDto['status']`），
 * 但 zod 需要一份真实的字面量数组，故在此重列一遍并用 `satisfies` 咬合：
 *  · 多一个 / 拼错一个 ⇒ `satisfies` 当场报红；
 *  · 少一个 ⇒ 由 `services/ws/taskSocket.test.ts` 里的穷举断言兜住（两个方向都封死）。
 */
export const TASK_STATUSES = [
  'running',
  'succeeded',
  'failed',
  'killed',
  'timed_out',
] as const satisfies readonly TaskStatus[];
export const TaskStatusSchema = z.enum(TASK_STATUSES);

// ——— /terminal 通道：浏览器 → 服务端 ———
export const TerminalClientFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string() }),
  z.object({ type: z.literal('resize'), cols: z.number().int(), rows: z.number().int() }),
  z.object({ type: z.literal('ping') }),
]);
export type TerminalClientFrame = z.infer<typeof TerminalClientFrameSchema>;

// ——— /terminal 通道：服务端 → 浏览器 ———
export const TerminalServerFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('data'), data: z.string() }), // plain string，xterm 直接 write
  z.object({ type: z.literal('exit'), code: z.number().int() }),
  z.object({ type: z.literal('pong') }),
  z.object({ type: z.literal('session'), socketSessionKey: z.string() }), // 开会话首帧下发重连凭据
]);
export type TerminalServerFrame = z.infer<typeof TerminalServerFrameSchema>;

/**
 * runtime CLI 安装状态（10 §7.1 `RuntimeInstallStatus`，对应 13 `runtime_installations.status`）。
 * 只被 `runtime.install_progress` 使用。
 */
export const RuntimeInstallStatusSchema = z.enum([
  'not_installed',
  'installing',
  'installed',
  'failed',
]);
export type RuntimeInstallStatus = z.infer<typeof RuntimeInstallStatusSchema>;

// ——— /events 通道：判别键 event（10 §7.4 共 7 条）———
export const SandboxEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('sandbox.created'), sandboxId: z.string(), projectId: z.string() }),
  z.object({
    event: z.literal('sandbox.status_changed'),
    sandboxId: z.string(),
    status: z.string(),
    phase: z.string().optional(),
    // 失败原因码（04 §4 闭集，无码错误兜底 INTERNAL）：**仅 status:'failed' 时出现**，其余恒 undefined。
    // 由领域事件直接带字段下发（不从散文回 regex 出码）；人话按码查 P22 §1。
    // 这是失败原因的**即时**通道；刷新后的恢复通道是 SandboxResponseDto.failureCode（10 §7.3）。
    errorCode: z.string().optional(),
  }),
  z.object({ event: z.literal('sandbox.removed'), sandboxId: z.string() }),
  z.object({
    event: z.literal('sandbox.waiting_input'),
    sandboxId: z.string(),
    waiting: z.boolean(),
    sessionId: z.string().optional(),
  }),
  z.object({
    event: z.literal('project.clone_progress'),
    projectId: z.string(),
    phase: z.enum(['cloning', 'slow', 'done', 'failed']),
    receivedBytes: z.number().optional(),
    totalBytes: z.number().optional(),
    percent: z.number().optional(),
    errorCode: z.string().optional(),
  }),
  z.object({ event: z.literal('runtime-auth.status_changed'), runtime: z.string() }),
  // 装 runtime CLI 的进度（S5，TASK-LAUNCH-DECISIONS T-3）。单开一条而不复用 sandbox.status_changed：
  // 装 CLI 期间 status 恒为 'starting'，而现装实测可达 753s（12.5min）——复用会推出一串
  // "状态没变的状态变更事件"，破坏 status_changed「每一次状态机转移」的语义（10 §3.1）。
  // 前端纪律（15 §2.3）：**不 patch 任何 Query 字段**，只喂进度卡「启动实例」格下的子文案。
  z.object({
    event: z.literal('runtime.install_progress'),
    sandboxId: z.string(),
    runtime: z.string(),
    status: RuntimeInstallStatusSchema,
    versionDetected: z.string().optional(),
    // 契约里有这个字段，但**前端不拿它当失败原因**：install_progress 不是失败兜底通道（10 §3.1），
    // 失败原因一律取 sandbox.status_changed.errorCode / SandboxResponseDto.failureCode。
    errorCode: z.string().optional(),
  }),
]);
export type SandboxEvent = z.infer<typeof SandboxEventSchema>;

// ————————————————————————————————————————————————————————————————
// /tasks 通道（S6 无头 Task）：判别键 `type`，**双向**（客户端发订阅、服务端推事件）。
// SYNC WITH 后端 S6 权威定义 —— 手工跨仓同步（与上面两个通道同一纪律）。
// 三条通道的判别键刻意不同源：/terminal 用 `type`（字节流帧）、/events 用 `event`（业务投影）、
// /tasks 用 `type`（既有控制帧也有事件帧）——各自 zod 兜底，误 parse 会在入口被挡下。
// ————————————————————————————————————————————————————————————————

/** 浏览器 → 服务端。`fromSeq` 是刷新/重连恢复的**唯一**补齐手段（本切片零轮询）。 */
export const TaskClientFrameSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    taskId: z.string(),
    /** 省略 = 从头回放；带值 = 只回放这之后的（见 lib/taskStream `buildSubscribeFrame`）。 */
    fromSeq: z.number().int().nonnegative().optional(),
  }),
  z.object({ type: z.literal('unsubscribe'), taskId: z.string() }),
  z.object({ type: z.literal('ping') }),
]);
export type TaskClientFrame = z.infer<typeof TaskClientFrameSchema>;

/**
 * runtime 事件类型（**7 值**）。
 * ⚠️ `agent-message` 是 agent 自己的**正文散文**，`stdout-chunk` 只剩"无结构化输出模式的 runtime
 * 吐出来的裸字节"——两者分开是刻意的（后端 04 §3 ★4），漏掉 `agent-message` 会让 agent 的正文
 * 一条都渲染不出来。`session-started` **不给用户看**，只用来取 `ref`。
 */
export const RuntimeEventTypeSchema = z.enum([
  'session-started',
  'agent-message',
  'stdout-chunk',
  'tool-call',
  'task-complete',
  'error',
  'auth-required',
]);
export type RuntimeEventType = z.infer<typeof RuntimeEventTypeSchema>;

/**
 * 工具调用的载荷：**一次调用两帧，按 `id` 配对**。
 *
 * ⚠️ `name` 只在 `started` 上，这是后端刻意的：claude 的完成半场（`tool_result`）只带
 * `tool_use_id` 拿不到工具名，而解析器**必须无状态**——一张 id→name 表会让实时解析与回放解析
 * 对同一段字节产出**不同**载荷，那是 `seq` 回放绝不能出现的事。所以消费方按 `id` 配对，
 * 名字在 `started` 那一帧就已经到了。
 */
export const ToolCallDataSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('started'),
    id: z.string(),
    name: z.string(),
    input: z.unknown().optional(),
  }),
  z.object({
    status: z.literal('completed'),
    id: z.string(),
    /**
     * **真实退出码，永不合成** —— 只有 codex（`command_execution`）会给。
     * 后端刻意没有把 claude 的 `is_error` 合成成 `exitCode: 1`：那样一来同一个字段里
     * "实测的 1"和"从布尔捏出来的 1"长得一模一样，消费方再也分不出来。
     */
    exitCode: z.number().int().optional(),
    /**
     * "工具自己说它失败了" —— 只有 claude（`tool_result.is_error`）会给，且**只在 true 时出现**。
     * ⚠️ 两个都缺席 = **没有报告失败**，不是"成功了"，更不是失败（判定见 lib/taskStream 的 toolCallFailed）。
     */
    isError: z.boolean().optional(),
    output: z.string().optional(),
  }),
]);
export type ToolCallData = z.infer<typeof ToolCallDataSchema>;

/**
 * 一条 runtime 事件。**载荷逐成员钉死，不是 `unknown`**。
 *
 * 上一版这里是 `data: unknown`，那是真缺陷不是风格问题：载荷不透明时消费方只能猜哪个字段装正文
 * （`text`? `chunk`? `content`?），于是"输出能不能渲染"取决于生产方偶然挑了哪个名字，改名在
 * 编译期和 schema 校验里都不会响。钉死之后生产方与消费方**一起**在构建期失败。
 *
 * `timestamp` 是 ISO-8601，**可能是空串**（parseOutput 跑在基础设施层、没有 Clock）。
 */
export const RuntimeEventSchema = z.discriminatedUnion('type', [
  /** CLI 自己的会话 id —— 存下来，下一轮当 `resumeFrom` 交回去。 */
  z.object({
    type: z.literal('session-started'),
    timestamp: z.string(),
    data: z.object({ ref: z.string() }),
  }),
  /** agent 自己的正文散文。 */
  z.object({
    type: z.literal('agent-message'),
    timestamp: z.string(),
    data: z.object({ text: z.string() }),
  }),
  /** 无结构化输出模式的 runtime 吐出的裸字节。 */
  z.object({
    type: z.literal('stdout-chunk'),
    timestamp: z.string(),
    data: z.object({ text: z.string() }),
  }),
  z.object({ type: z.literal('tool-call'), timestamp: z.string(), data: ToolCallDataSchema }),
  /**
   * runtime 说这一轮结束了。**载荷刻意为空**——退出码是**作业**的事实，在 /tasks 的 `exit` 帧上，
   * 不在这里（实测两个 CLI 的完成事件都不带退出码）。
   */
  z.object({ type: z.literal('task-complete'), timestamp: z.string(), data: z.object({}) }),
  /** 注意：这里**只有 message 没有 code**；码在通道级 `error` 帧上。 */
  z.object({
    type: z.literal('error'),
    timestamp: z.string(),
    data: z.object({ message: z.string() }),
  }),
  /** ⏳ 两个内建 adapter 目前都还不产出它（后端注释）。 */
  z.object({
    type: z.literal('auth-required'),
    timestamp: z.string(),
    data: z.object({ method: z.string().optional() }),
  }),
]);
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;

/** 服务端 → 浏览器。`exit.exitCode` **可能缺席**（被信号杀掉没有退出码）。 */
export const TaskServerFrameSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('event'),
    taskId: z.string(),
    /** 平台自己的**稠密单调**序号（不是字节偏移）。有缺口即 bug，前端显式报警不容忍。 */
    seq: z.number().int(),
    event: RuntimeEventSchema,
  }),
  /**
   * 回放结束，之后是直推。
   *  · `seq` = 到此为止投递过的最大序号（回放为空时 = 请求的 `fromSeq`）；
   *  · `firstSeq` = 本次回放**实际发出的第一条**的序号，一条都没发时 = `seq + 1`（空区间）。
   *
   * ⚠️ `firstSeq` 是**唯一**能发现"回放被砍头"的手段：没有它，只能看出流**中间**的缺口，
   * 而开头被丢掉（平台回放不到那么早）看起来跟"这条流本来就从这里开始"一模一样。
   * 消费方拿 `firstSeq` 与 `fromSeq + 1` 比：大于 ⇒ 开头缺了，必须说出来，
   * 而不是把一份残缺的记录当完整的渲染出去。
   */
  z.object({
    type: z.literal('caught_up'),
    taskId: z.string(),
    firstSeq: z.number().int(),
    seq: z.number().int(),
  }),
  /**
   * 终态。**迟到的订阅者也会收到**：订阅一个早已结束的任务，回放之后仍然补发一帧 `exit`，
   * 所以前端不需要再从 REST DTO 反推终态（那等于同一个事实有两个真相源）。
   */
  z.object({
    type: z.literal('exit'),
    taskId: z.string(),
    status: TaskStatusSchema,
    exitCode: z.number().int().optional(),
  }),
  // 通道级错误：**永远是码不是句子**（P22 §1），人话由前端按码渲染。
  z.object({ type: z.literal('error'), taskId: z.string(), code: z.string() }),
  z.object({ type: z.literal('pong') }),
]);
export type TaskServerFrame = z.infer<typeof TaskServerFrameSchema>;

/**
 * 帧形状的**跨仓对账字面量**——与 `api/packages/contracts/src/ws-protocol.ts` 里的同名常量
 * 必须逐字节相同，由主仓 `scripts/docs-check.mjs` 的 B4 门禁比对。
 *
 * 为什么需要它：REST 面有 openapi codegen 兜着（改 DTO ⇒ 两仓一起在 tsc 阶段红），
 * **WS 面是三份手抄**（shared/10 §7.4 ↔ api contracts ↔ 本文件），零 codegen、零门禁，
 * 而 S6 增量的主体恰恰是 WS。这条不比结构（那会脆），只比两仓各自声明的字面量：
 * 改帧形状就必须两边同时改，与 `WS_TASKS_SCHEMA_HASH` 的「钉死字面量」纪律同款。
 *
 * ⚠️ 光有字面量还不够——字面量和本文件的 zod schema 也可能各说各话。所以
 * `ws-protocol.test.ts` 从 schema **反推**出这段描述再逐字比对：
 * 「api 字面量 == web 字面量」（B4）+「web 字面量 == web schema」（单测）
 * ⇒ 传递地钉住「api 帧形状 == web 运行时校验」。
 *
 * 格式：`通道:帧名{字段,可选字段?},…|通道:…`；判别键本身不列（它就是帧名）。
 */
export const WS_PROTOCOL_CANONICAL =
  'terminal.client:input{data},resize{cols,rows},ping|' +
  'terminal.server:data{data},exit{code},pong,session{socketSessionKey}|' +
  'events:sandbox.created{sandboxId,projectId},sandbox.status_changed{sandboxId,status,phase?,errorCode?},' +
  'sandbox.removed{sandboxId},sandbox.waiting_input{sandboxId,waiting,sessionId?},' +
  'project.clone_progress{projectId,phase,receivedBytes?,totalBytes?,percent?,errorCode?},' +
  'runtime-auth.status_changed{runtime},' +
  'runtime.install_progress{sandboxId,runtime,status,versionDetected?,errorCode?}|' +
  'tasks.client:subscribe{taskId,fromSeq?},unsubscribe{taskId},ping|' +
  'tasks.server:event{taskId,seq,event},caught_up{taskId,firstSeq,seq},' +
  'exit{taskId,status,exitCode?},error{taskId,code},pong';
