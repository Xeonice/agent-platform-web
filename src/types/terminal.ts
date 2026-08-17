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
