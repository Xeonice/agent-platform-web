// 终端传输层与渲染器的共享类型（15 §4：connState 是浏览器↔网关传输层状态）。
// 放 types/ 使 service（ptySocket）、store（registry）、view（ConnectionStatus）三层都能共享而不违反分层铁律。
export type ConnState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
export type RendererKind = 'webgl' | 'canvas' | 'dom';

/** socket.io /terminal 连接描述（放 types/ 供 lib/hook/container 共享而不破分层）。 */
export interface TerminalSocketConfig {
  /** `<origin>/terminal`，交给 io() 作为连接 uri。 */
  uri: string;
  /** 基础 query（sandboxId + cols/rows + xSchemaHash）；重连凭据由 ptySocket 追加。 */
  query: Record<string, string>;
}

/**
 * `exit{code}` 里表示"平台**没能附着上**"的哨兵码（与 api 的
 * `TERMINAL_EXIT_ATTACH_FAILED` 逐字对应）。
 *
 * ⚠️ 为什么不能复用 `-1`：`-1` 已经表示"进程真的退出了但退出码未知"（被信号杀死，
 * 例如 OOM）。合并之后，一个被 OOM kill 的 agent 会被告知"实例可能已不存在"——
 * 而那两件事对用户的下一步完全不同：前者等结果/看日志，后者只能重新发起任务。
 *
 * ⚠️ 它落在既有帧的既有字段里（`code` 本就是 number），所以**不参与 `WS_SCHEMA_HASH`**、
 * 也不进 `WS_PROTOCOL_CANONICAL` ⇒ `docs:check` 的 B4 看不见它。跨仓一致性今天只能
 * 靠这条注释和两侧的测试，与 `WS_SCHEMA_HASH` 是同一类字面量对（14 §2.4 的
 * X-Schema-Hash 工具链落地后应一并收编）。
 *
 * 放在 types 而不是 lib：container 层不得直接依赖 lib（boundaries），而这个码正是
 * container 在用。
 */
export const TERMINAL_EXIT_ATTACH_FAILED = -2;
