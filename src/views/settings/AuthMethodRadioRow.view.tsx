// 模式单选行（F21-3 §3，P21-3 §6）：◉/○ 单选 + [生效中] 徽标 + 掩码 + 有效期（⚠️<7天 / ❌过期）+ 行内动作。
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

function expiryMarker(row: AuthModeRow): { text: string; className: string } | null {
  if (row.expiryState === 'warning') {
    return { text: `⚠️ ${row.expiryLabel ?? '即将过期'}`, className: 'text-amber-400' };
  }
  if (row.expiryState === 'expired') {
    return { text: '❌ 已过期', className: 'text-red-400' };
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
              生效中
            </span>
          )}
        </label>
        {marker !== null && <span className={'text-xs ' + marker.className}>{marker.text}</span>}
      </div>

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
              {isAccount ? '重新授权' : '更换'}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRevoke}>
              吊销
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
            {isAccount ? '帐号授权' : '添加 API Key'}
          </Button>
        </div>
      )}
    </div>
  );
}
