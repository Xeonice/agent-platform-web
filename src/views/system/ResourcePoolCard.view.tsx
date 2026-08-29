// 资源池水位卡（F21-5 §3/§6 前四行 · P21-5 §5 · 审计 P1-9）。纯展示、props 驱动、零副作用。
//
// ⚠️ **三个维度各自的档次与整体档次都由 lib 算好**（`lib/system/resourceModel.ts`）：
// view 层碰不到 lib，也不该碰——阈值一旦出现在这里，就会变成"页面上还有一份阈值"。
// 这里只做一件事：把 `level` 翻成图标 / 文字 / 颜色**三重线索**（a11y：颜色不是唯一线索）。
//
// ⚠️ **整体那一行说的是最差维度，不是平均**：`{cpu:10%, ram:20%, disk:98%}` 要显示
// 「资源耗尽，无法创建新 Task」。判定在 lib，但这一行的存在本身是产品要求——把三条水位条
// 摆出来让用户自己看，等于把"还能不能再发一个 Task"这个唯一的问题留给他自己算。
import { Button } from '@/components/ui/button';
import type { ResourceGaugeModel, ResourceLevel, ResourcePoolCardModel } from '@/types/system';

/** 三重线索之一：图标。⚠️ 与 `LEVEL_TEXT`、`LEVEL_BAR` 是三份**并列**的线索，不是装饰。 */
const LEVEL_ICON: Readonly<Record<ResourceLevel, string>> = {
  ok: '✅',
  warn: '⚠️',
  critical: '🔴',
};
const LEVEL_TEXT: Readonly<Record<ResourceLevel, string>> = {
  ok: '正常',
  warn: '警告',
  critical: '严重',
};
const LEVEL_BAR: Readonly<Record<ResourceLevel, string>> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  critical: 'bg-red-500',
};

export interface ResourcePoolCardProps {
  /** `null` = 还没取到（加载中或失败）。 */
  model: ResourcePoolCardModel | null;
  isError: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  /** [清理保留卷] → 保留卷管理（停 Task 不释放保留卷，所以磁盘告警要有它自己的出路）。 */
  onCleanupRetained: () => void;
}

function Gauge({ gauge }: { gauge: ResourceGaugeModel }) {
  return (
    <li data-testid={`resource-gauge-${gauge.id}`} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true">{LEVEL_ICON[gauge.level]}</span>
          <span className="font-medium">{gauge.label}</span>
          {/* 文字线索：屏幕阅读器与色觉障碍用户靠它，不靠上面那个图标也不靠下面的颜色。 */}
          <span className="text-xs text-muted-foreground">{LEVEL_TEXT[gauge.level]}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {gauge.amountText}（{gauge.usedPercent}%）
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${gauge.label} 使用率`}
        aria-valuenow={gauge.usedPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={`h-full rounded-full ${LEVEL_BAR[gauge.level]}`}
          style={{ width: `${String(Math.min(100, Math.max(0, gauge.usedPercent)))}%` }}
        />
      </div>
    </li>
  );
}

export function ResourcePoolCardView({
  model,
  isError,
  isRefreshing,
  onRefresh,
  onCleanupRetained,
}: ResourcePoolCardProps) {
  return (
    <section
      aria-labelledby="resource-pool-heading"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="resource-pool-heading" className="text-base font-semibold">
          📊 资源池水位
        </h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isRefreshing}
          onClick={onRefresh}
        >
          {isRefreshing ? '刷新中…' : '刷新'}
        </Button>
      </header>

      {isError ? (
        // ⛔ 失败**不许**退化成"0%"或空水位条：一条空水位条读起来是"很空闲"，
        //    而真相是这个数字根本没取到。
        <p role="alert" className="text-sm text-red-500">
          ❌ 资源水位读取失败，当前数字不可用 —— 请点 [刷新] 重试
        </p>
      ) : model === null ? (
        <p className="text-sm text-muted-foreground">读取中…</p>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {model.gauges.map((gauge) => (
              <Gauge key={gauge.id} gauge={gauge} />
            ))}
          </ul>

          <p data-testid="resource-overall" className="flex flex-wrap items-center gap-2 text-sm">
            <span aria-hidden="true">{LEVEL_ICON[model.overallLevel]}</span>
            <span className="font-medium">{model.overallText}</span>
            <span className="text-muted-foreground">
              · 当前活跃 Task: {model.activeTasks} · 调度预留 {model.reservedPercent}%
              （进度条分母仍是总容量）
            </span>
          </p>

          <div
            data-testid="retained-volumes"
            className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs"
          >
            <span aria-hidden="true">🎁</span>
            <span>
              保留卷占用 {model.retained.sizeText}（{model.retained.count} 个 ·{' '}
              {model.retained.shareText}）
            </span>
            {model.retained.countdownText === undefined ? null : (
              <span className="text-muted-foreground">⏱️ {model.retained.countdownText}</span>
            )}
            {model.retained.truncated ? (
              // ⚠️ 截断了却报一个确切数字，用户清完发现没腾出预期的空间，此后不会再信这个数字。
              <span className="text-amber-600">
                ⚠️ 目录过多，统计已截断 —— 实际占用不小于这个数
              </span>
            ) : null}
            {model.showCleanupRetained ? (
              <Button type="button" size="sm" variant="outline" onClick={onCleanupRetained}>
                清理保留卷
              </Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
