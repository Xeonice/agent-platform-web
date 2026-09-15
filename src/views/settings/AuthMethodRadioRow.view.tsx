// 模式单选行（F21-3 §3，P21-3 §6）：◉/○ 单选 + [当前使用] 徽标 + 帐号尾号 + 有效期
// （警告 <7 天 / 已过期）**+ 到期后该做什么** + 行内动作。
// 点未配置项 → onNeedSetup（就地补配，不报错）而非 onSwitch（F21-3 §5 / §7.2 play）。纯展示、props 驱动、零副作用。
import { AlertTriangle, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPill, type StatusPillStatus } from '@/components/ui/status-pill';
import type { AuthModeRow } from '@/types/runtimeCredential';

export interface AuthMethodRadioRowProps {
  row: AuthModeRow;
  /** ○ 切到已配置模式（确认弹层）。 */
  onSwitch: () => void;
  /** ○ 切到未配置模式（就地展开配置面板，不报错）。 */
  onNeedSetup: () => void;
  /** 帐号授权行：[帐号授权]（未配置）/ [重新授权]（已配置）。 */
  onReauth: () => void;
  /** API Key 行：[添加 API Key]（未配置）/ [更换]（已配置）。 */
  onAddKey: () => void;
  /** [吊销]（已配置）。 */
  onRevoke: () => void;
  busy?: boolean;
}

/**
 * 有效期标记 + **下一步**。
 *
 * ⛔ 此前预警行只有「⚠️ 剩 5 天」四个字，**没有告诉用户该做什么** —— 而产品 §5 要求
 *    「建议在 X 前重新授权」，同一份产品的另一处也早就在说「建议尽快重新授权」。
 *    本该是权威页面的这一页反而最简陋：一个倒计时，一个叹号，没有出口。
 *
 * ⚠️ `hint` 只说「该做什么」，**不承诺时间、不编数字**：「还剩多久」由 `expiryLabel`
 *    （lib `formatDaysLeft` 算出来的那一份）负责，这里不再算第二遍、也不复述。
 */
interface ExpiryMarker {
  text: string;
  hint?: string;
  /** 装饰图标；缺席 = 普通有效期（既不警告也没过期），不需要图标提醒。仅纯文字分支使用。 */
  icon?: LucideIcon;
  className?: string;
  /**
   * 设了这个字段 = 这一格改走 `StatusPill`，不再走下面 icon+className 的纯文字渲染。
   *
   * ⚠️ **只有 `expired` 走 pill，`warning` 刻意不跟进**：`warning` 这里显示的是
   * `expiryLabel`（"剩 6 天" 这种动态倒计时），不是"即将过期"这句固定状态文案——
   * 原型（design/prototype.html #credentials 第 647 行）里同一格也是纯色 mono 文字，
   * 不是 pill；`expired` 才是没有倒计时可言的终态，对应 design-notes.md Phase 6
   * 映射表里的「已过期 → fail」。
   */
  pillStatus?: StatusPillStatus;
}

function expiryMarker(row: AuthModeRow): ExpiryMarker | null {
  if (row.expiryState === 'warning') {
    return {
      text: row.expiryLabel ?? '快到期了',
      className: 'text-amber-400',
      icon: AlertTriangle,
      // ⚠️ 不在这里重算天数、也不重复念一遍 —— 「还剩多久」就在旁边那个标记里（`expiryLabel`），
      //    这一句只负责补上它缺的那一半：**该做什么**。
      hint: '建议在它到期前重新登录一次，免得任务跑到一半断掉。',
    };
  }
  if (row.expiryState === 'expired') {
    return {
      text: '已过期',
      pillStatus: 'fail',
      hint: '现在用它发任务会失败，点 [重新登录] 换一份。',
    };
  }
  if (row.expiryLabel !== undefined) {
    return { text: row.expiryLabel, className: 'text-muted-foreground' };
  }
  return null;
}

export function AuthMethodRadioRowView({
  row,
  onSwitch,
  onNeedSetup,
  onReauth,
  onAddKey,
  onRevoke,
  busy = false,
}: AuthMethodRadioRowProps) {
  const isAccount = row.mode === 'account';
  const marker = expiryMarker(row);

  const handleSelect = (): void => {
    if (row.active) return;
    if (row.configured) onSwitch();
    else onNeedSetup();
  };

  return (
    // ⭐ 不自带边框/圆角：这一行不是自己的卡，是父卡（`RuntimeCredentialCardView`）内部
    // 用分隔线分出来的一法。此前这里自带 `rounded-md border`，卡片内再套一层边框，
    // 「哪个是一张卡」变得含糊（design/prototype.html #credentials + design-notes.md
    // Phase 6 ③：分隔线代替卡中卡）。分隔线本身由父级的 `divide-y` 提供，⛔ 这里不重复画。
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`auth-mode-${row.mode}`}
            checked={row.active}
            aria-label={row.label}
            onChange={handleSelect}
          />
          <span className="font-medium">{row.label}</span>
          {row.active && (
            <StatusPill status="ok" data-testid="auth-active-badge">
              当前使用
            </StatusPill>
          )}
        </label>
        {marker !== null &&
          (marker.pillStatus !== undefined ? (
            <StatusPill status={marker.pillStatus} data-testid="auth-expiry-marker">
              {marker.text}
            </StatusPill>
          ) : (
            <span
              className={'flex items-center gap-1 text-xs ' + (marker.className ?? '')}
              data-testid="auth-expiry-marker"
            >
              {marker.icon !== undefined && (
                <marker.icon aria-hidden="true" className="h-3 w-3 shrink-0" />
              )}
              {marker.text}
            </span>
          ))}
      </div>

      {marker?.hint !== undefined && (
        <p className="pl-6 text-xs text-muted-foreground">{marker.hint}</p>
      )}

      {row.configured ? (
        <div className="flex flex-col gap-2 pl-6">
          {row.maskedIdentifier !== undefined && (
            <span className="font-mono text-xs text-muted-foreground">{row.maskedIdentifier}</span>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={isAccount ? onReauth : onAddKey}
            >
              {isAccount ? '重新登录' : '更换'}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRevoke}>
              删除
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pl-6">
          <StatusPill status="skipped" data-testid="auth-unconfigured-badge">
            未配置
          </StatusPill>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={isAccount ? onReauth : onAddKey}
          >
            {isAccount ? '登录帐号' : '添加 API Key'}
          </Button>
        </div>
      )}
    </div>
  );
}
