// 「这台机器的沙箱环境」状态卡（F21-5 §3/§6 · P21-5 §3）。纯展示、props 驱动、零副作用。
//
// ⚠️ **「无样本」不是「0%」，也不是「正常」。** 后端在这一小时没有沙箱创建记录时**刻意
// 不下发** `recentFailureRate`（0/0 不是 0%）。这里给它一个自己的图标（⚪）与自己的一句话，
// ⛔ 不许并进 ✅ —— 一台刚装好的机器亮起「失败率 0% ✅」，读者会把它当成一次实测结论。
//
// ⚠️ **失败率的分档与 `healthy` 不是一回事**：`healthy` 只管有没有越过 ❌ 线（10%），
// ⚠️ 线（1%）在它眼里也是"健康"。分档在 lib 算，这里只翻图标。
//
import { Square, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ProviderLogPanelView,
  type ProviderLogPanelProps,
} from '@/views/system/ProviderLogPanel.view';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusPill, type StatusPillStatus } from '@/components/ui/status-pill';
import type { ProviderHealthLevel, SandboxEnvStatusCardModel } from '@/types/system';

/**
 * `ProviderHealthLevel` → `StatusPill` 八态（design/design-notes.md §4 Phase 1 第三条：
 * 沙箱环境状态换 `StatusPill`）。⚠️ **`no-sample` 映射到 `unknown`**（虚线灰）而不是
 * `ok`/`pending`——它既不是"好"也不是"坏"，而是"没有数据可以下结论"，与诊断的
 * `timeout ≠ fail` 是同一条纪律的另一处落地。
 */
const SANDBOX_ENV_PILL_STATUS: Readonly<Record<ProviderHealthLevel, StatusPillStatus>> = {
  ok: 'ok',
  warning: 'warn',
  error: 'fail',
  'no-sample': 'unknown',
};
const SANDBOX_ENV_LEVEL_TEXT: Readonly<Record<ProviderHealthLevel, string>> = {
  ok: '正常',
  warning: '失败率偏高',
  error: '故障',
  'no-sample': '无样本',
};

export interface SandboxEnvStatusCardProps {
  model: SandboxEnvStatusCardModel | null;
  isError: boolean;
  openLogProviderId?: string | null;
  logPanel?: Omit<ProviderLogPanelProps, 'id'>;
  onToggleLogs?: (providerId: string) => void;
  loadingProviderCount?: number;
  loadingRuntimeCount?: number;
}

export function SandboxEnvStatusCardView({
  model,
  isError,
  openLogProviderId,
  logPanel,
  onToggleLogs,
  loadingProviderCount = 1,
  loadingRuntimeCount = 1,
}: SandboxEnvStatusCardProps) {
  return (
    <section
      aria-labelledby="sandbox-env-status-heading"
      aria-busy={!isError && model === null}
      className="flex flex-col gap-3 rounded-lg border border-border p-4 [container-type:inline-size]"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        {/* ⚠️ 只改可见文案，不改文件名/组件名/类型名（design-notes §4 Phase 1 +
            §5 拍板点 1：`SandboxEnvStatusCard` 这个名字已经在上一轮改过，这一轮
            只把标题从「这台机器的沙箱环境」换成「沙箱环境状态」，与同页其它三张卡
            「X状态」的命名对齐）。 */}
        <h2 id="sandbox-env-status-heading" className="text-base font-semibold">
          沙箱环境状态
        </h2>
        {model === null && !isError ? (
          <Skeleton
            aria-hidden="true"
            className="h-8 w-full [@container(min-width:400px)]:hidden"
          />
        ) : model === null ? null : (
          <span className="text-xs text-muted-foreground">
            健康统计窗口：{model.windowText}
            {model.thresholdText === undefined ? '' : `（${model.thresholdText}）`}
          </span>
        )}
      </header>

      {isError ? (
        <p role="alert" className="flex items-center gap-1.5 text-sm text-red-500">
          <XCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
          沙箱环境概览读取失败 —— 这里的空白不代表这台机器上没有沙箱环境
        </p>
      ) : model === null ? (
        <div>
          <p role="status" className="sr-only">
            沙箱环境读取中…
          </p>
          <div aria-hidden="true" className="space-y-3" data-testid="providers-skeleton">
            {Array.from({ length: loadingProviderCount }, (_, id) => (
              <div
                key={id}
                className="flex flex-col gap-0.5 rounded-md border border-border/60 px-3 py-2"
              >
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-56 max-w-full" />
                <Skeleton className="h-8 w-full [@container(min-width:400px)]:h-4" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
            <div className="space-y-1">
              <Skeleton className="h-5 w-16" />
              {Array.from({ length: loadingRuntimeCount }, (_, id) => (
                <Skeleton key={id} className="h-8 w-full [@container(min-width:400px)]:h-[18px]" />
              ))}
            </div>
            <div className="space-y-1">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {model.providers.map((p) => (
              <li
                key={p.id}
                data-testid={`sandbox-env-row-${p.id}`}
                className="flex flex-col gap-0.5 rounded-md border border-border/60 px-3 py-2 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <StatusPill status={SANDBOX_ENV_PILL_STATUS[p.level]}>
                    {SANDBOX_ENV_LEVEL_TEXT[p.level]}
                  </StatusPill>
                  {/* ⚠️ 光一个 `aio` / `boxlite`，用户无从判断哪个是哪个（映射在 lib，
                      未知 provider 原样用 id —— 开放注册表，猜一个描述比不给更贵）。 */}
                  <span className="font-medium" data-testid={`sandbox-env-name-${p.id}`}>
                    {p.displayName}
                  </span>
                  {p.isDefault ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">默认</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">{p.failureText}</span>
                <span className="text-xs text-muted-foreground">能力：{p.capabilityText}</span>
                {onToggleLogs === undefined ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    aria-expanded={openLogProviderId === p.id}
                    aria-controls={`provider-log-${p.id}`}
                    onClick={() => {
                      onToggleLogs(p.id);
                    }}
                  >
                    {openLogProviderId === p.id ? '收起日志' : '查看日志'}
                  </Button>
                )}
                {openLogProviderId === p.id && logPanel !== undefined ? (
                  <ProviderLogPanelView id={`provider-log-${p.id}`} {...logPanel} />
                ) : null}
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Agent</h3>
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {model.runtimes.map((r) => (
                <li
                  key={r.id}
                  data-testid={`runtime-row-${r.id}`}
                  className="flex items-center gap-2"
                >
                  {/* 紧凑型：只留图标（design/prototype.html Agent 分组的 `status-pill`
                      同样只给 18px 高、无文字，行内密度高不需要重复的文字标签）。 */}
                  {r.credentialConfigured ? (
                    <StatusPill status="ok" className="h-[18px] px-1" aria-label="凭证已配置" />
                  ) : (
                    <span
                      aria-label="凭证未配置"
                      className="inline-flex h-[18px] items-center gap-1 rounded-full bg-[var(--v2-status-neutral-subtle-bg)] px-2 text-xs text-muted-foreground"
                    >
                      <Square aria-hidden="true" className="h-2.5 w-2.5 fill-current" />
                      停用
                    </span>
                  )}
                  <span>
                    {r.displayName}（{r.vendor}）· {r.credentialText} · 授权方式 {r.authMethodsText}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">镜像读取方式</h3>
            <ul className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {model.imageSpecs.map((s) => (
                <li key={s.id} data-testid={`image-spec-${s.id}`}>
                  {s.id}
                  {s.isDefault ? '（默认）' : ''}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
