// SYNC WITH shared/10 §7.4 — 修改需双端确认
// WS 帧类型的前端权威副本（zod schema 为运行时校验唯一源）。
// 两个通道判别键不同：/terminal 用 `type`（字节流帧）、/events 用 `event`（业务投影）——刻意区分防误 parse（10 §7.4）。
import { z } from 'zod';

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
