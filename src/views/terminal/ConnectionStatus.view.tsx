// Connection observations do not decide the task's domain status or replay input.
import Link from 'next/link';
import type { ConnState, TerminalAttachmentState } from '@/types/terminal';
export interface ConnectionStatusProps {
  connState: ConnState;
  attempt?: number;
  onManualReconnect: () => void;
  handshakeErrorMessage?: string;
  sessionEndedMessage?: string;
  attachmentState?: TerminalAttachmentState;
  restoringSlow?: boolean;
  canRetry?: boolean;
}
export function ConnectionStatusView({
  connState,
  attempt = 0,
  onManualReconnect,
  handshakeErrorMessage,
  sessionEndedMessage,
  attachmentState,
  restoringSlow = false,
  canRetry = true,
}: ConnectionStatusProps) {
  if (sessionEndedMessage !== undefined && sessionEndedMessage !== '') {
    return (
      <div
        role="alert"
        data-testid="terminal-session-ended"
        className="flex items-center gap-2 bg-amber-500/15 px-3 py-1.5 text-xs text-amber-300"
      >
        <span>{sessionEndedMessage}</span>
      </div>
    );
  }
  if (handshakeErrorMessage !== undefined && handshakeErrorMessage !== '') {
    return (
      <div
        role="status"
        data-testid="terminal-handshake-error"
        className="flex flex-wrap items-center gap-2 bg-muted px-3 py-1.5 text-xs text-muted-foreground"
      >
        <span>{handshakeErrorMessage}</span>
        {restoringSlow && canRetry ? <span>续接超过 15 秒，保留原任务与画布。</span> : null}
        {canRetry ? (
          <button type="button" className="underline" onClick={onManualReconnect}>
            手动重连
          </button>
        ) : null}
        <Link className="underline" href="/settings/system">
          查看系统状态
        </Link>
      </div>
    );
  }
  if (connState === 'open' && (attachmentState === undefined || attachmentState === 'attached'))
    return null;
  if (restoringSlow || connState === 'closed') {
    return (
      <div
        role="status"
        data-testid="terminal-restoring-slow"
        className="flex flex-wrap items-center gap-2 bg-muted px-3 py-1.5 text-xs text-muted-foreground"
      >
        <span>
          {restoringSlow
            ? '原终端续接超过 15 秒，运行状态暂时无法确认。'
            : '暂时未接上原终端，运行状态待确认。'}
          保留原任务与画布，可重试或查看状态。
        </span>
        {canRetry ? (
          <button type="button" className="underline" onClick={onManualReconnect}>
            手动重连
          </button>
        ) : null}
        <Link className="underline" href="/settings/system">
          查看系统状态
        </Link>
      </div>
    );
  }
  return (
    <div
      role="status"
      className="flex items-center gap-2 bg-muted px-3 py-1.5 text-xs text-muted-foreground"
    >
      {connState === 'reconnecting'
        ? `正在重连…（第 ${String(attempt)} 次），等待确认原终端。`
        : '正在续接原终端，等待运行环境与终端身份确认…'}
    </div>
  );
}
