// 单条出网探测结果（F21-8 §3 · P21-8 §2）。纯展示、props 驱动、零副作用。
//
// ⚠️ **「模型 API」与「镜像仓库」必须在这一行上就分得开。** 离线判定只看前者（P21-8 §1
// 的物理约束），所以用户看到一条红的时候，第一个要回答的问题是"它属于哪一类"：
// 镜像仓库不通 = 拉不到新镜像；模型 API 不通 = Agent 根本跑不了。两句话的严重度差一个量级。
//
// ⚠️ **`hint` 原样整段渲染，不截断。** 后端那句带着这一次实测的具体原因（连接超时 / TLS 失败 /
// 内网要配代理），而这一行的全部价值就在它里面。
import type { ConnectivityRowModel } from '@/types/init';

export interface ConnectivityItemProps {
  row: ConnectivityRowModel;
  /** 检测进行中：整行 ⏳（后端不逐目标推送，所以是整轮一起转）。 */
  pending?: boolean;
}

export function ConnectivityItemView({ row, pending = false }: ConnectivityItemProps) {
  return (
    <li
      data-testid={`connectivity-item-${row.id}`}
      data-ok={row.ok ? 'true' : 'false'}
      data-model-api={row.modelApi ? 'true' : 'false'}
      className="flex flex-col gap-1 rounded-md border border-border/60 px-3 py-2 text-sm"
    >
      <span className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true">{pending ? '⏳' : row.ok ? '✅' : '❌'}</span>
        <span className="font-medium">{row.target}</span>
        <span
          data-testid={`connectivity-kind-${row.id}`}
          className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          {row.kindText}
        </span>
        <span className="text-xs text-muted-foreground">{pending ? '检测中…' : row.stateText}</span>
      </span>
      {row.hint === undefined || pending ? null : (
        <span className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {row.hint}
        </span>
      )}
    </li>
  );
}
