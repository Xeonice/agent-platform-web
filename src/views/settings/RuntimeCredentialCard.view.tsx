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
  expandedMode?: RuntimeAuthMode;
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

/** 凭证 none 映射为 skipped，未配置不等于错误；其它状态沿用 StatusPill 语义。 */
const STATUS_PILL_STATUS: Record<RuntimeCredentialCardModel['status'], StatusPillStatus> = {
  none: 'skipped',
  active: 'ok',
  expiring: 'warn',
  expired: 'fail',
};

export function RuntimeCredentialCardView({
  model,
  expandedSlot,
  expandedMode,
  onSwitch,
  onNeedSetup,
  onReauth,
  onAddKey,
  onRevoke,
  rowBusy,
}: RuntimeCredentialCardProps) {
  return (
    <div
      role="group"
      aria-label={model.displayName}
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 id={`runtime-card-${model.runtimeId}`} className="text-sm font-semibold">
            {model.displayName}
          </h3>
          <span className="text-xs text-muted-foreground">{model.vendor}</span>
        </div>
        <StatusPill status={STATUS_PILL_STATUS[model.status]} data-testid="credential-status-pill">
          {STATUS_LABEL[model.status]}
        </StatusPill>
      </header>

      {/* 外层卡片内用分隔线组织帐号登录与 API Key，避免重复嵌套边框。 */}
      <div
        role="radiogroup"
        aria-labelledby={`runtime-card-${model.runtimeId}`}
        className="divide-y divide-border"
      >
        {model.rows.map((row) => (
          <AuthMethodRadioRowView
            key={row.mode}
            row={row}
            runtimeId={model.runtimeId}
            panelExpanded={
              expandedSlot !== undefined &&
              expandedSlot !== null &&
              (expandedMode === undefined || expandedMode === row.mode)
            }
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

      <div
        id={`runtime-auth-panel-${model.runtimeId}`}
        className={expandedSlot == null ? undefined : 'border-t border-border p-5'}
      >
        {expandedSlot}
      </div>
      {(model.pendingTeardownCount ?? 0) > 0 && (
        <p role="status" className="px-5 py-3 text-[13px] text-[var(--v2-status-warn-fg)]">
          这份凭证已删除，还有 {model.pendingTeardownCount}{' '}
          个任务正在清理；平台会继续重试，代码副本会保留为成果。
        </p>
      )}
    </div>
  );
}
