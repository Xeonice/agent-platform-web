// 资源池水位卡（F21-5 §3/§6 前四行 · P21-5 §5 · 审计 P1-9）。纯展示、props 驱动、零副作用。
//
// ⚠️ **三个维度各自的档次与整体档次都由 lib 算好**（`lib/system/resourceModel.ts`）：
// view 层碰不到 lib，也不该碰——阈值一旦出现在这里，就会变成"页面上还有一份阈值"。
// 这里只做一件事：把 `level` 翻成图标 / 文字 / 颜色**三重线索**（a11y：颜色不是唯一线索）。
//
// ⚠️ **整体那一行说的是最差维度，不是平均**：`{cpu:10%, ram:20%, disk:98%}` 要显示
// 「资源耗尽，无法创建新 Task」。判定在 lib，但这一行的存在本身是产品要求——把三条水位条
// 摆出来让用户自己看，等于把"还能不能再发一个 Task"这个唯一的问题留给他自己算。
import { AlertTriangle, CircleX, Clock, Gift, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import type { Ref } from 'react';
import { StatusPill, type StatusPillStatus } from '@/components/ui/status-pill';
import type { ResourceGaugeModel, ResourceLevel, ResourcePoolCardModel } from '@/types/system';

/** 资源水位沿用 StatusPill；critical 映射 fail，耗尽不能弱化为 warn。 */
const LEVEL_PILL_STATUS: Readonly<Record<ResourceLevel, StatusPillStatus>> = {
  ok: 'ok',
  warn: 'warn',
  critical: 'fail',
};
const LEVEL_TEXT: Readonly<Record<ResourceLevel, string>> = {
  ok: '正常',
  warn: '警告',
  critical: '严重',
};
/** Progress Indicator 通过子选择器覆盖，颜色复用 success/warning/error 语义 token。 */
const LEVEL_BAR: Readonly<Record<ResourceLevel, string>> = {
  ok: '[&>div]:bg-success',
  warn: '[&>div]:bg-warning',
  critical: '[&>div]:bg-error',
};

export interface ResourcePoolCardProps {
  /** `null` = 还没取到（加载中或失败）。 */
  model: ResourcePoolCardModel | null;
  isError: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  /** [清理保留卷] → 保留卷管理（停 Task 不释放保留卷，所以磁盘告警要有它自己的出路）。 */
  onCleanupRetained: () => void;
  cleanupTriggerRef?: Ref<HTMLButtonElement> | undefined;
}

function Gauge({ gauge }: { gauge: ResourceGaugeModel }) {
  return (
    <li data-testid={`resource-gauge-${gauge.id}`} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5">
          <StatusPill status={LEVEL_PILL_STATUS[gauge.level]}>{LEVEL_TEXT[gauge.level]}</StatusPill>
          <span data-testid={`resource-gauge-label-${gauge.id}`} className="font-medium">
            {gauge.label}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {gauge.amountText}（{gauge.usedPercent}%）
        </span>
      </div>
      {/* ⚠️ 真实路径独立成行，⛔ 不拼进上面的标题行——见 `ResourceGaugeModel.pathText`
          字段注释：拼进标题会把状态 pill 挤成两行（真实布局 bug）。允许换行/截断，
          它不与状态行抢一行的宽度。 */}
      {gauge.pathText === undefined ? null : (
        <span
          data-testid={`resource-gauge-path-${gauge.id}`}
          className="truncate text-xs text-muted-foreground"
          title={gauge.pathText}
        >
          {gauge.pathText}
        </span>
      )}
      {/* 细进度条保留灰色底槽；重要性前缀确保底槽颜色不被 Progress 默认背景覆盖。 */}
      <Progress
        value={Math.min(100, Math.max(0, gauge.usedPercent))}
        aria-label={`${gauge.label} 使用率`}
        className={`!h-1.5 !bg-background-subtle ${LEVEL_BAR[gauge.level]}`}
      />
    </li>
  );
}

export function ResourcePoolCardView({
  model,
  isError,
  isRefreshing,
  onRefresh,
  onCleanupRetained,
  cleanupTriggerRef,
}: ResourcePoolCardProps) {
  return (
    <section
      aria-labelledby="resource-pool-heading"
      aria-busy={!isError && model === null}
      className="flex flex-col gap-3 rounded-lg border border-border p-4 [container-type:inline-size]"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="resource-pool-heading" className="text-base font-semibold">
          本机资源水位
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
        <p role="alert" className="flex items-center gap-1.5 text-sm text-red-500">
          <XCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
          本机资源读取失败，当前数字不可用 —— 请点 [刷新] 重试
        </p>
      ) : model === null ? (
        <div>
          <p role="status" className="sr-only">
            本机资源读取中…
          </p>
          <div aria-hidden="true" className="space-y-3" data-testid="resources-skeleton">
            <div className="space-y-1">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-8 w-full [@container(min-width:300px)]:h-4" />
            </div>
            {['cpu', 'ram', 'disk'].map((id) => (
              <div key={id} className="space-y-1">
                <div className="flex justify-between">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-4 w-20" />
                </div>
                {id === 'disk' && <Skeleton className="h-4 w-32" />}
                <Skeleton className="h-1.5 w-full" />
              </div>
            ))}
            <div className="space-y-1">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-8 w-full [@container(min-width:400px)]:h-4" />
            </div>
            <Skeleton className="h-[72px] w-full [@container(min-width:400px)]:h-[34px]" />
          </div>
        </div>
      ) : (
        <>
          {model.capacityText === undefined ? null : (
            <div className="space-y-1" data-testid="resource-capacity">
              <p className="flex items-center gap-2 text-xl font-semibold">
                {model.capacityLevel === 'critical' ? (
                  <CircleX aria-hidden="true" className="h-5 w-5 text-destructive" />
                ) : model.capacityLevel === 'warn' ? (
                  <AlertTriangle aria-hidden="true" className="h-5 w-5 text-warning" />
                ) : null}
                <span
                  className={
                    model.capacityLevel === 'critical' ? 'text-destructive' : 'text-foreground'
                  }
                >
                  {model.capacityText}
                </span>
              </p>
              <p className="min-h-8 text-xs text-muted-foreground sm:min-h-4">
                {model.capacityHint}
              </p>
            </div>
          )}
          <ul className="flex flex-col gap-3">
            {model.gauges.map((gauge) => (
              <Gauge key={gauge.id} gauge={gauge} />
            ))}
          </ul>
          <div data-testid="resource-overall" className="space-y-1">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              {/* ⚠️ pill 文字跟着 `overallLevel` 走（正常/警告/严重），⛔ 不是原型里那个
                永远 `ok`/「就绪」的静态演示样例——那份原型数据没有覆盖 critical 场景，
                原样照抄会在资源耗尽时显示一枚绿色的「就绪」，与旁边「无法创建新 Task」
                自相矛盾。 */}
              <StatusPill status={LEVEL_PILL_STATUS[model.overallLevel]}>
                {LEVEL_TEXT[model.overallLevel]}
              </StatusPill>
              <span className="font-medium">{model.overallText}</span>
            </p>
            <p className="min-h-8 text-xs text-muted-foreground sm:min-h-4">
              {model.capacityText === undefined ? <>· 当前活跃任务：{model.activeTasks} </> : null}·
              留出 {model.reservedPercent}% 不拿去跑任务（上面的进度条分母仍然是总容量）
            </p>
          </div>
          {model.nextSteps?.map((step) => (
            <p key={step} className="text-sm">
              {step}
            </p>
          ))}

          <div
            data-testid="retained-volumes"
            className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs"
          >
            <Gift aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span>
              成果占用 {model.retained.sizeText}（{model.retained.count} 个 ·{' '}
              {model.retained.shareText}）
            </span>
            {model.retained.countdownText === undefined ? null : (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                {model.retained.countdownText}
              </span>
            )}
            {model.retained.truncated ? (
              // ⚠️ 截断了却报一个确切数字，用户清完发现没腾出预期的空间，此后不会再信这个数字。
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                目录过多，统计已截断 —— 实际占用不小于这个数
              </span>
            ) : null}
            {model.retained.level === 'ok' ? null : (
              <p role="status" className="flex w-full flex-wrap items-center gap-2">
                <StatusPill status="warn">警告</StatusPill>
                {model.retained.warningText}
              </p>
            )}
            {model.showCleanupRetained ? (
              <Button
                ref={cleanupTriggerRef}
                type="button"
                size="sm"
                variant="outline"
                onClick={onCleanupRetained}
              >
                清理成果
              </Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
