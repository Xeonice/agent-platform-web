// 终端顶部内嵌条：重连黄条 / 连接超时（08 §11.6）。纯展示，props 驱动，零副作用。
import type { ConnState } from '@/types/terminal';

export interface ConnectionStatusProps {
  connState: ConnState;
  attempt?: number;
  onManualReconnect?: () => void;
}

export function ConnectionStatusView({
  connState,
  attempt = 0,
  onManualReconnect,
}: ConnectionStatusProps) {
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
        <span>连接超时</span>
        <button type="button" className="underline" onClick={onManualReconnect}>
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
