// 连接状态卡（F21-5 §3/§6）。纯展示、props 驱动、零副作用。
//
// ⚠️ **三态而不是两态**：`ok` / `down` / `unknown`。
// 「测不了」用 ⚪ 而不是 🔴 —— 把"本页没有测量这条通道"渲染成"已断开"，是每次进设置页
// 都会亮一次的**假警报**，而假警报比不检查更贵（同 P21-5 §9B 对端口检查的那句）。
// 这与诊断里 `timeout ≠ fail` 是同一条纪律的两处落地。
//
// ⚠️ `unknown` 那一行**必须带上"为什么测不了"**（`hint`）：只写一个「未测量」，读者
// 唯一能得到的结论是"这个界面没做完"。
import type { ConnectionState, ConnectionStatusCardModel } from '@/types/system';

const STATE_ICON: Readonly<Record<ConnectionState, string>> = {
  ok: '✅',
  down: '🔴',
  unknown: '⚪',
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
        🌐 连接状态
      </h2>
      <ul className="flex flex-col gap-2">
        {model.rows.map((row) => (
          <li
            key={row.id}
            data-testid={`connection-row-${row.id}`}
            className="flex flex-col gap-0.5 text-sm"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span aria-hidden="true">{STATE_ICON[row.state]}</span>
              <span className="font-medium">{row.label}</span>
              {/* 文字线索与图标并列（a11y：颜色/图标都不是唯一线索）。 */}
              <span className="text-xs text-muted-foreground">{STATE_TEXT[row.state]}</span>
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
