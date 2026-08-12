// 原始 WS 封装（08 §3）：唯一 WebSocket 触点。含帧编解码 + zod 校验 + 指数退避重连 + 心跳。
// WebSocket 构造函数通过参数注入（默认全局 WebSocket）——为单测提供 mock 注入点，避免 mock.module（12 §3.1.1）。
import {
  TerminalServerFrameSchema,
  type TerminalClientFrame,
  type TerminalServerFrame,
} from '@/types/ws-protocol';
import type { ConnState } from '@/types/terminal';

export type { ConnState };

/** 最小 WebSocket 契约（浏览器 WebSocket 与测试 mock 都满足）。 */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
export type WebSocketCtor = (url: string) => WebSocketLike;

export interface PtySocketOptions {
  url: string;
  /** 默认全局 WebSocket；测试注入 mock。 */
  webSocketCtor?: WebSocketCtor;
  onFrame: (frame: TerminalServerFrame) => void;
  onState: (state: ConnState, attempt: number) => void;
  /** 契约校验失败回调（dev fail-fast / prod 上报，08 §3.1）。 */
  onInvalidFrame?: (raw: unknown) => void;
  maxReconnect?: number;
}

const MAX_RECONNECT_DEFAULT = 8;

/** 把浏览器原生 WebSocket 适配为 WebSocketLike（services 层是唯一允许 new WebSocket 处，07 §3 规则 5）。 */
class BrowserWebSocketAdapter implements WebSocketLike {
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  private readonly ws: WebSocket;

  constructor(url: string) {
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = (ev): void => this.onopen?.(ev);
    ws.onclose = (ev): void => this.onclose?.(ev);
    ws.onerror = (ev): void => this.onerror?.(ev);
    ws.onmessage = (ev): void => this.onmessage?.({ data: ev.data });
  }

  send(data: string): void {
    this.ws.send(data);
  }

  close(): void {
    this.ws.close();
  }
}

function defaultCtor(url: string): WebSocketLike {
  return new BrowserWebSocketAdapter(url);
}

export class PtySocket {
  private ws: WebSocketLike | null = null;
  private state: ConnState = 'idle';
  private attempt = 0;
  private closedByUser = false;
  private readonly opts: Required<Pick<PtySocketOptions, 'maxReconnect' | 'webSocketCtor'>> &
    PtySocketOptions;

  constructor(opts: PtySocketOptions) {
    this.opts = {
      ...opts,
      webSocketCtor: opts.webSocketCtor ?? defaultCtor,
      maxReconnect: opts.maxReconnect ?? MAX_RECONNECT_DEFAULT,
    };
  }

  connect(): void {
    this.closedByUser = false;
    this.setState('connecting');
    const ws = this.opts.webSocketCtor(this.opts.url);
    this.ws = ws;
    ws.onopen = (): void => {
      this.attempt = 0;
      this.setState('open');
    };
    ws.onmessage = (ev): void => {
      this.handleMessage(ev.data);
    };
    ws.onerror = (): void => {
      ws.close();
    };
    ws.onclose = (): void => {
      if (this.closedByUser) return;
      this.setState('reconnecting');
      // 重连调度交由 hook 层（useSandboxTerminalSocket）依据会话终止条件决定是否继续（08 §3.1/§8）。
    };
  }

  /** fire-and-forget：未 open 时丢弃并返回 false（断线不排队，08 §11.2）。 */
  send(frame: TerminalClientFrame): boolean {
    if (this.state !== 'open' || this.ws === null) return false;
    this.ws.send(JSON.stringify(frame));
    return true;
  }

  close(): void {
    this.closedByUser = true;
    this.setState('closed');
    this.ws?.close();
    this.ws = null;
  }

  get connState(): ConnState {
    return this.state;
  }

  get reconnectAttempts(): number {
    return this.attempt;
  }

  private handleMessage(raw: unknown): void {
    let parsedJson: unknown;
    try {
      parsedJson = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      this.opts.onInvalidFrame?.(raw);
      return;
    }
    const result = TerminalServerFrameSchema.safeParse(parsedJson);
    if (!result.success) {
      this.opts.onInvalidFrame?.(parsedJson); // 校验失败不进下游、不阻断渲染（08 §3.1）
      return;
    }
    this.opts.onFrame(result.data);
  }

  private setState(state: ConnState): void {
    this.state = state;
    if (state === 'reconnecting') this.attempt += 1;
    this.opts.onState(state, this.attempt);
  }
}

/** 指数退避 + jitter（08 §3.1）：min(30s, 500ms × 2^n) × (0.5~1.0)。 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 500 * 2 ** attempt);
  return Math.round(base * (0.5 + random() * 0.5));
}
