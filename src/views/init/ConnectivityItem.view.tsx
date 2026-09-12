// 单条出网探测结果（F21-8 §3 · P21-8 §2）。纯展示、props 驱动、零副作用。
//
// ⚠️ **「模型 API」与「镜像仓库」必须在这一行上就分得开。** 离线判定只看前者（P21-8 §1
// 的物理约束），所以用户看到一条红的时候，第一个要回答的问题是"它属于哪一类"：
// 镜像仓库不通 = 拉不到新镜像；模型 API 不通 = Agent 根本跑不了。两句话的严重度差一个量级。
//
// ⚠️ **`hint` 原样整段渲染，不截断。** 后端那句带着这一次实测的具体原因（连接超时 / TLS 失败 /
// 内网要配代理），而这一行的全部价值就在它里面。
//
// ⚠️ **状态用 `StatusPill`（design/design-notes.md §2 八态对照表）**，⛔ 不再是手写 emoji：
// `timeout`（超时未响应）与 `fail`（连不上）是两个独立色相、两个独立图标——这正是产品文档
// 反复订正的那条纪律（P21-5 §9E「超时 ≠ 不可达」）：颜色/图标长得一样，用户会把"网络抖了
// 一下"和"这东西是坏的"当成同一件事去修，而修法完全不同。
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
      className="flex flex-col gap-1 rounded-md border border-border/60 px-3 py-2 text-sm"
    >
      <span className="flex flex-wrap items-center gap-2">
        <StatusPill status={status}>{statusText}</StatusPill>
        <span className="font-medium">{row.target}</span>
        <span
          data-testid={`connectivity-kind-${row.id}`}
          className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          {row.kindText}
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
