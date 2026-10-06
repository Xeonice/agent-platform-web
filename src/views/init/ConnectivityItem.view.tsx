// 联网检查使用 StatusPill 表达颜色、图标与文字三重线索，避免仅靠颜色或装饰图标。
import { StatusPill } from '@/components/ui/status-pill';
import type { ConnectivityRowModel } from '@/types/init';

export interface ConnectivityItemProps {
  row: ConnectivityRowModel;
  /** 检测进行中：整行转圈（后端不逐目标推送，所以是整轮一起转）。 */
  pending?: boolean;
}

export function ConnectivityItemView({ row, pending = false }: ConnectivityItemProps) {
  const status = pending ? 'pending' : row.ok ? 'ok' : row.timedOut === true ? 'timeout' : 'fail';
  const statusText = pending ? '检测中…' : row.stateText;
  return (
    <li
      data-testid={`connectivity-item-${row.id}`}
      data-ok={row.ok ? 'true' : 'false'}
      data-timed-out={row.timedOut === true ? 'true' : 'false'}
      data-model-api={row.modelApi ? 'true' : 'false'}
      className="flex flex-col gap-2 px-4 py-3 text-sm"
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{row.target}</span>
        <span
          data-testid={`connectivity-kind-${row.id}`}
          className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          {row.kindText}
        </span>
        <span className="ml-auto">
          <StatusPill status={status}>{statusText}</StatusPill>
        </span>
      </span>
      {row.hint === undefined || pending ? null : (
        <span className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {row.hint}
        </span>
      )}
    </li>
  );
}
