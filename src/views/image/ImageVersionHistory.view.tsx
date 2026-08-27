// 卡片背后的历史版本列表（P21-4 §5 ★，F21-4 §5.1）。纯展示、props 驱动、零副作用。
//
// 为什么要有这么一块：产品裁决把「更新到新版本」定义成 **INSERT 一行新 manifest + 旧行下线**，
// 不是就地改旧行——于是同一张镜像在库里天然是**多行**。卡面只说当前活行那一件事，
// 其余行必须有地方可看，否则「回滚到旧版本」在界面上根本没有入口，而回滚（上游推了一个坏 build）
// 是很平常的需求。
//
// ⚠️ **[切换到此版本] 打的是 `POST /api/images/:id/activate`，不是 `PATCH { isActive:true }`**
//（后端对后者明确回 400 并指向 activate）。这块 view 不知道端点，但它把语义写在按钮上：
// 「切换」而不是「启用」——同一个动作同时是「更新到新版本」和「回滚到旧版本」。
//
// ⚠️ 已经是活行的那一行**不给按钮**（不是给了再置灰）：对当前版本点"切换到此版本"没有意义。
import { Button } from '@/components/ui/button';
import type { ImageVersionRowModel } from '@/types/image';

export interface ImageVersionHistoryProps {
  rows: readonly ImageVersionRowModel[];
  /** 正在切换的那一行 id（按钮 loading）。 */
  switchingId?: string;
  onSwitchVersion: (manifestId: string) => void;
}

/** 历史行只给一个中性状态字，不复用卡面的三级大标题——那句话是给"当前在跑的版本"说的。 */
const STATUS_LABEL: Record<ImageVersionRowModel['validationStatus'], string> = {
  valid: '✅ 有效',
  warning: '⚠️ 有警告',
  invalid: '❌ 无效',
  // 卡面必须在三档里选一档，历史列表不必：这里如实说"没判过"。
  pending: '· 未判定',
};

export function ImageVersionHistoryView({
  rows,
  switchingId,
  onSwitchVersion,
}: ImageVersionHistoryProps) {
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border p-2 text-xs">
      <span className="text-muted-foreground">🕐 历史版本（{rows.length}）</span>
      <ul className="flex flex-col gap-1" data-testid="image-version-history">
        {rows.map((row) => (
          <li
            key={row.id}
            data-testid="image-version-row"
            data-manifest-id={row.id}
            data-active={String(row.isActive)}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="font-mono">{row.version}</span>
            {/* 未解析的 digest 不留白、不显示假哈希——与卡面同一口径。 */}
            <span className="font-mono text-muted-foreground">
              {row.digestShort ?? '⚠️ 未解析'}
            </span>
            <span className="text-muted-foreground">{STATUS_LABEL[row.validationStatus]}</span>
            {row.isActive ? (
              <span className="text-muted-foreground">（当前版本）</span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={switchingId === row.id}
                onClick={() => {
                  onSwitchVersion(row.id);
                }}
              >
                {switchingId === row.id ? '切换中…' : '切换到此版本'}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
