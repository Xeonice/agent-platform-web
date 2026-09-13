// 模式单选行（F21-3 §3，P21-3 §6）：◉/○ 单选 + [当前使用] 徽标 + 帐号尾号 + 有效期（⚠️<7天 / ❌过期）
// **+ 到期后该做什么** + 行内动作。
// 点未配置项 → onNeedSetup（就地补配，不报错）而非 onSwitch（F21-3 §5 / §7.2 play）。纯展示、props 驱动、零副作用。
import { Button } from '@/components/ui/button';
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
function expiryMarker(row: AuthModeRow): { text: string; className: string; hint?: string } | null {
  if (row.expiryState === 'warning') {
    return {
      text: `⚠️ ${row.expiryLabel ?? '快到期了'}`,
      className: 'text-amber-400',
      // ⚠️ 不在这里重算天数、也不重复念一遍 —— 「还剩多久」就在旁边那个标记里（`expiryLabel`），
      //    这一句只负责补上它缺的那一半：**该做什么**。
      hint: '建议在它到期前重新登录一次，免得任务跑到一半断掉。',
    };
  }
  if (row.expiryState === 'expired') {
    return {
      text: '❌ 已过期',
      className: 'text-red-400',
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
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
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
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              当前使用
            </span>
          )}
        </label>
        {marker !== null && <span className={'text-xs ' + marker.className}>{marker.text}</span>}
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
          <span className="text-xs text-muted-foreground">未配置</span>
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
