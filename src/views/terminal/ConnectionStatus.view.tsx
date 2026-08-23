// 终端顶部内嵌条：重连黄条 / 连接超时 / 协议漂移（08 §11.6）。纯展示，props 驱动，零副作用。
import type { ConnState } from '@/types/terminal';

export interface ConnectionStatusProps {
  connState: ConnState;
  attempt?: number;
  /**
   * 退避耗尽（`connState==='closed'`）后的唯一出路。
   *
   * ⚠️ **必填，刻意的**。此前它是可选的、而 TerminalMount 一直没接线 ⇒ 界面上那个「手动重连」
   * 是个死按钮（点了没反应，比没有按钮更糟）。改必填后，"渲染了终端连接条却没给出路"这件事
   * 由 tsc 在编译期挡住，而不是靠人记得接线——view 层没有别的手段能防住它。
   */
  onManualReconnect: () => void;
  /**
   * 握手被拒的人话（非未授权那一类，如版本漂移）。非空时**接管整条状态条**。
   *
   * ⚠️ 为什么必须接管而不是叠加一行：这一类失败是确定性的，「手动重连」按不通。
   * 把它和"连接超时，手动重连"并排放，等于同时给出一条真出路和一条假出路，
   * 而用户只会去按那个按钮——那正是终端上刚修掉的死按钮的同一种病，换了个来源。
   */
  handshakeErrorMessage?: string;
}

export function ConnectionStatusView({
  connState,
  attempt = 0,
  onManualReconnect,
  handshakeErrorMessage,
}: ConnectionStatusProps) {
  // 协议漂移优先于一切连接态：连不上的原因已经确定，别再显示"正在重连…"。
  if (handshakeErrorMessage !== undefined && handshakeErrorMessage !== '') {
    return (
      <div
        role="alert"
        data-testid="terminal-handshake-error"
        className="flex items-center gap-2 bg-red-500/15 px-3 py-1.5 text-xs text-red-300"
      >
        <span>{handshakeErrorMessage}</span>
      </div>
    );
  }

  if (connState === 'open') return null;

  if (connState === 'reconnecting') {
    return (
      <div
        role="status"
        className="flex items-center gap-2 bg-yellow-500/15 px-3 py-1.5 text-xs text-yellow-300"
      >
        <span aria-hidden>●</span>
        <span>正在重连…（第 {attempt} 次）</span>
      </div>
    );
  }

  if (connState === 'closed') {
    return (
      <div
        role="alert"
        className="flex items-center gap-2 bg-red-500/15 px-3 py-1.5 text-xs text-red-300"
      >
        <span>连接超时，已停止自动重连。</span>
        <button
          type="button"
          className="underline"
          onClick={() => {
            onManualReconnect();
          }}
        >
          手动重连
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-muted px-3 py-1.5 text-xs text-muted-foreground">
      连接中…
    </div>
  );
}
