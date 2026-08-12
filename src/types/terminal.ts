// 终端传输层与渲染器的共享类型（15 §4：connState 是浏览器↔网关传输层状态）。
// 放 types/ 使 service（ptySocket）、store（registry）、view（ConnectionStatus）三层都能共享而不违反分层铁律。
export type ConnState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
export type RendererKind = 'webgl' | 'canvas' | 'dom';
