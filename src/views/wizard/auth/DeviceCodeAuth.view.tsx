// A · device-code（Codex，07 §6.2）：大字号 userCode + [复制] + [打开验证链接] + 15:00 倒计时
//（剩 5min 转黄、归零转红 + [重新获取]）+「等待授权中…」轮询态。纯展示、props 驱动、零副作用。
import { Button } from '@/components/ui/button';

export interface DeviceCodeAuthProps {
  userCode: string;
  verificationUrl: string;
  /** 剩余秒数（hook 倒计时派生）。 */
  secondsLeft: number;
  /** 是否轮询中（展示「等待授权中…」）。 */
  polling: boolean;
  /** 连续网络错误（展示「网络异常 [重试]」，倒计时不受影响，P22 §2）。 */
  pollError: boolean;
  /** 是否已过期（归零/服务端 expired → [重新获取]）。 */
  expired: boolean;
  onCopy?: () => void;
  onRefetchChallenge: () => void;
}

const WARN_THRESHOLD_SEC = 5 * 60;

function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function DeviceCodeAuthView({
  userCode,
  verificationUrl,
  secondsLeft,
  polling,
  pollError,
  expired,
  onCopy,
  onRefetchChallenge,
}: DeviceCodeAuthProps) {
  const countdownColor = expired
    ? 'text-red-400'
    : secondsLeft <= WARN_THRESHOLD_SEC
      ? 'text-amber-400'
      : 'text-muted-foreground';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">在下方页面输入设备码完成授权：</span>
        <div className="flex items-center gap-2">
          <code
            aria-label="设备码"
            className="select-all rounded-md bg-muted px-3 py-2 font-mono text-2xl tracking-widest"
          >
            {userCode}
          </code>
          <Button type="button" variant="outline" size="sm" onClick={onCopy}>
            复制
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={verificationUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary underline-offset-2 hover:underline"
        >
          打开验证链接 ↗
        </a>
        <span aria-label="倒计时" className={'font-mono text-sm ' + countdownColor}>
          {formatCountdown(secondsLeft)}
        </span>
      </div>

      {expired ? (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-xs text-red-400">
            设备码已过期。
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onRefetchChallenge}>
            重新获取
          </Button>
        </div>
      ) : pollError ? (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-xs text-amber-400">
            网络异常，正在重试…
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={onRefetchChallenge}>
            重试
          </Button>
        </div>
      ) : (
        polling && (
          <p role="status" className="text-xs text-muted-foreground">
            等待授权中…
          </p>
        )
      )}
    </div>
  );
}
