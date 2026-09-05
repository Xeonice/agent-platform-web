// A · device-code（Codex，F07 §6.2 / §6.2a）：[打开授权页 ↗]（主按钮，开新标签页 + 复制码）
// + 大字号 userCode + [复制] + 15:00 倒计时（剩 5min 转黄、归零转红 + [重新获取]）
// +「等待授权中…」轮询态。纯展示、props 驱动、零副作用。
//
// ⚠️ **`window.open` 不在这里调**（那是副作用）：本视图只把点击原样交给 `onOpenAuthPage`，
//    由容器同步执行。⛔ 但那一层的同步性靠的是**这里直接把 handler 挂在 onClick 上** ——
//    中间任何一次 await / setTimeout 都会让它失去用户手势、被浏览器拦掉。
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
  /**
   * [打开授权页] —— 开新标签页 + 把设备码复制进剪贴板。
   * ⚠️ 容器里必须**同步**执行 `window.open`（F07 §6.2a ①）。
   */
  onOpenAuthPage: () => void;
  /**
   * 弹窗被浏览器拦了。
   * ⛔ 这一格必须显形：静默失败时用户会盯着「等待授权中…」等到码过期，而什么都没发生。
   */
  popupBlocked?: boolean;
  /** 设备码已复制进剪贴板（给一句「已复制」，用户才知道可以直接粘贴）。 */
  codeCopied?: boolean;
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
  onOpenAuthPage,
  popupBlocked,
  codeCopied,
}: DeviceCodeAuthProps) {
  const countdownColor = expired
    ? 'text-red-400'
    : secondsLeft <= WARN_THRESHOLD_SEC
      ? 'text-amber-400'
      : 'text-muted-foreground';

  return (
    <div className="flex flex-col gap-3">
      {/* ① 主动作：开新标签页。⚠️ handler 直接挂 onClick，中间不许有 await（见文件头）。 */}
      <div className="flex flex-col gap-1">
        <Button type="button" onClick={onOpenAuthPage} data-testid="open-auth-page">
          打开授权页 ↗
        </Button>
        <span className="text-xs text-muted-foreground">
          会打开一个新标签页；本页留在这里等结果，授权完成后会自己变。
        </span>
      </div>

      {/* ⛔ 被拦了要显形，并给出一条真能点的路 —— 不许装作开了。 */}
      {popupBlocked === true && (
        <p role="alert" data-testid="popup-blocked" className="text-xs text-amber-400">
          浏览器拦了弹窗 ——{' '}
          <a
            href={verificationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            点这里手动打开
          </a>
        </p>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">
          在新标签页粘贴这串设备码{codeCopied === true ? '（已复制到剪贴板）' : ''}：
        </span>
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

      {/* ⚠️ 原来这里是一个小号「打开验证链接」文字链 —— 它与「大字号设备码」并排，
          读起来像「码是主角、链接是附注」，而实际顺序相反：**先开页面，再粘码**。
          ⇒ 主入口上移成按钮，这里只留倒计时。 */}
      <div className="flex flex-wrap items-center gap-3">
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
