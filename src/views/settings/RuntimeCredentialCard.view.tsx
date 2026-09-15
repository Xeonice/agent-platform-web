// Runtime 凭证卡片（F21-3 §3）：按 runtime 分组，组内 帐号授权 / API Key 两行并列（AuthMethodRadioRow）+
// 卡片状态头 + 就地展开的授权面板 slot（AuthGateContainer，**内嵌非 modal**，F21-3 §5「重授权中」）。
// 无凭证时为简化态（两行仍在，均显未配置 CTA）。纯展示、props 驱动、零副作用。
import type { ReactNode } from 'react';
import { StatusPill, type StatusPillStatus } from '@/components/ui/status-pill';
import { AuthMethodRadioRowView } from '@/views/settings/AuthMethodRadioRow.view';
import type {
  RuntimeCredentialCardModel,
  RuntimeAuthMethod,
  RuntimeAuthMode,
} from '@/types/runtimeCredential';

export interface RuntimeCredentialCardProps {
  model: RuntimeCredentialCardModel;
  /** 就地展开的授权面板（容器按 expandedPanel 定位渲染 AuthGateContainer）。 */
  expandedSlot?: ReactNode;
  onSwitch: (mode: RuntimeAuthMode) => void;
  onNeedSetup: (mode: RuntimeAuthMode) => void;
  onReauth: (method: RuntimeAuthMethod) => void;
  onAddKey: () => void;
  onRevoke: (mode: RuntimeAuthMode) => void;
  /** 某模式行是否正被操作（精确 scope，只禁那一行；缺省=永不忙）。 */
  rowBusy?: (mode: RuntimeAuthMode) => boolean;
}

const STATUS_LABEL: Record<RuntimeCredentialCardModel['status'], string> = {
  none: '未配置',
  active: '有效',
  expiring: '即将过期',
  expired: '已过期',
};

/**
 * 卡片状态 → `StatusPill` 八态（design/prototype.html #credentials + design-notes.md
 * Phase 6 映射表）。
 *
 * ⚠️ `none` 映射到 `skipped`（虚线框），⛔ **不是 `fail`**——「未配置」不是错误，是
 * 「这一路没走」。只配了 API Key 没配帐号登录的用户，看见红色会以为自己弄坏了什么。
 */
const STATUS_PILL_STATUS: Record<RuntimeCredentialCardModel['status'], StatusPillStatus> = {
  none: 'skipped',
  active: 'ok',
  expiring: 'warn',
  expired: 'fail',
};

export function RuntimeCredentialCardView({
  model,
  expandedSlot,
  onSwitch,
  onNeedSetup,
  onReauth,
  onAddKey,
  onRevoke,
  rowBusy,
}: RuntimeCredentialCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <h3 className="text-sm font-semibold">{model.displayName}</h3>
          <span className="text-xs text-muted-foreground">{model.vendor}</span>
        </div>
        <StatusPill status={STATUS_PILL_STATUS[model.status]} data-testid="credential-status-pill">
          {STATUS_LABEL[model.status]}
        </StatusPill>
      </header>

      {/* ⭐ 分隔线代替卡中卡：外层已经是一张卡（`rounded-lg border`），帐号登录 / API Key
          两法不再各自套一层边框，改成 `divide-y` 分隔线（design/prototype.html #credentials
          `border-t border-border divide-y`；design-notes.md Phase 6 ③）——此前是
          `card > bordered-row` 两层边框，「哪个是一张卡」变得含糊。 */}
      <div className="flex flex-col divide-y divide-border border-t border-border">
        {model.rows.map((row) => (
          <AuthMethodRadioRowView
            key={row.mode}
            row={row}
            busy={rowBusy?.(row.mode) ?? false}
            onSwitch={() => {
              onSwitch(row.mode);
            }}
            onNeedSetup={() => {
              onNeedSetup(row.mode);
            }}
            onReauth={() => {
              onReauth(row.method);
            }}
            onAddKey={onAddKey}
            onRevoke={() => {
              onRevoke(row.mode);
            }}
          />
        ))}
      </div>

      {expandedSlot}
    </div>
  );
}
