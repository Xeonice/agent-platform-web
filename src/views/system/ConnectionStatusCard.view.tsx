// 连接状态区分 ok/down/unknown。测不了不等于已断开；unknown 必须说明未测量原因。
// StatusPill 映射为 ok/fail/unknown，避免未测量产生假警报。
import { StatusPill, type StatusPillStatus } from '@/components/ui/status-pill';
import type { ConnectionState, ConnectionStatusCardModel } from '@/types/system';

const STATE_PILL_STATUS: Readonly<Record<ConnectionState, StatusPillStatus>> = {
  ok: 'ok',
  down: 'fail',
  unknown: 'unknown',
};
const STATE_TEXT: Readonly<Record<ConnectionState, string>> = {
  ok: '正常',
  down: '异常',
  // 「未知」是结论的一种，不是缺省值。
  unknown: '未知',
};

export interface ConnectionStatusCardProps {
  model: ConnectionStatusCardModel;
}

export function ConnectionStatusCardView({ model }: ConnectionStatusCardProps) {
  return (
    <section
      aria-labelledby="connection-status-heading"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <h2 id="connection-status-heading" className="text-base font-semibold">
        连接状态
      </h2>
      <ul className="flex flex-col gap-2">
        {model.rows.map((row) => (
          <li
            key={row.id}
            data-testid={`connection-row-${row.id}`}
            className="flex flex-col gap-0.5 text-sm"
          >
            <span className="flex flex-wrap items-center gap-2">
              {row.showBadge === false ? null : (
                <StatusPill status={STATE_PILL_STATUS[row.state]}>
                  {STATE_TEXT[row.state]}
                </StatusPill>
              )}
              <span className="font-medium">{row.label}</span>
              <span className="text-muted-foreground">{row.valueText}</span>
            </span>
            {row.hint === undefined ? null : (
              <span className="text-xs text-muted-foreground">{row.hint}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
