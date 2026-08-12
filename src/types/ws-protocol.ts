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

// ——— /events 通道：判别键 event ———
export const SandboxEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('sandbox.created'), sandboxId: z.string(), projectId: z.string() }),
  z.object({
    event: z.literal('sandbox.status_changed'),
    sandboxId: z.string(),
    status: z.string(),
    phase: z.string().optional(),
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
]);
export type SandboxEvent = z.infer<typeof SandboxEventSchema>;
