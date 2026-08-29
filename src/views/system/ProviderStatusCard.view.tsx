// Provider 状态卡（F21-5 §3/§6 · P21-5 §3）。纯展示、props 驱动、零副作用。
//
// ⚠️ **「无样本」不是「0%」，也不是「正常」。** 后端在这一小时没有沙箱创建记录时**刻意
// 不下发** `recentFailureRate`（0/0 不是 0%）。这里给它一个自己的图标（⚪）与自己的一句话，
// ⛔ 不许并进 ✅ —— 一台刚装好的机器亮起「失败率 0% ✅」，读者会把它当成一次实测结论。
//
// ⚠️ **失败率的分档与 `healthy` 不是一回事**：`healthy` 只管有没有越过 ❌ 线（10%），
// ⚠️ 线（1%）在它眼里也是"健康"。分档在 lib 算，这里只翻图标。
//
// ⏳ **[查看日志] 本轮没有**：`ProviderLogPanel` 要的"最近 20 行运行日志"在契约里还没有
// 端点（10 §6.6 只有 providers 概览）。摆一个点了什么都不会发生的按钮，比暂时没有它更糟
// ——用户会以为日志功能坏了。缺口记在本轮报告里。
import type { ProviderHealthLevel, ProviderStatusCardModel } from '@/types/system';

const PROVIDER_ICON: Readonly<Record<ProviderHealthLevel, string>> = {
  ok: '✅',
  warning: '⚠️',
  error: '❌',
  // ⚠️ 单独一个图标：它既不是"好"也不是"坏"，而是"没有数据可以下结论"。
  'no-sample': '⚪',
};
const PROVIDER_LEVEL_TEXT: Readonly<Record<ProviderHealthLevel, string>> = {
  ok: '正常',
  warning: '失败率偏高',
  error: '故障',
  'no-sample': '无样本',
};

export interface ProviderStatusCardProps {
  model: ProviderStatusCardModel | null;
  isError: boolean;
}

export function ProviderStatusCardView({ model, isError }: ProviderStatusCardProps) {
  return (
    <section
      aria-labelledby="provider-status-heading"
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="provider-status-heading" className="text-base font-semibold">
          🏃 Provider 状态
        </h2>
        {model === null ? null : (
          <span className="text-xs text-muted-foreground">
            健康统计窗口：{model.windowText}（阈值 &gt;1% ⚠️ · &gt;10% ❌）
          </span>
        )}
      </header>

      {isError ? (
        <p role="alert" className="text-sm text-red-500">
          ❌ Provider 概览读取失败 —— 这里的空白不代表没有 provider
        </p>
      ) : model === null ? (
        <p className="text-sm text-muted-foreground">读取中…</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {model.providers.map((p) => (
              <li
                key={p.id}
                data-testid={`provider-row-${p.id}`}
                className="flex flex-col gap-0.5 rounded-md border border-border/60 px-3 py-2 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span aria-hidden="true">{PROVIDER_ICON[p.level]}</span>
                  <span className="font-medium">{p.id}</span>
                  <span className="text-xs text-muted-foreground">
                    {PROVIDER_LEVEL_TEXT[p.level]}
                  </span>
                  {p.isDefault ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">默认</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">{p.failureText}</span>
                <span className="text-xs text-muted-foreground">能力：{p.capabilityText}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Runtime</h3>
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {model.runtimes.map((r) => (
                <li key={r.id} data-testid={`runtime-row-${r.id}`}>
                  <span aria-hidden="true">{r.credentialConfigured ? '✅' : '⏸️'}</span>{' '}
                  {r.displayName}（{r.vendor}）· {r.credentialText} · 授权方式 {r.authMethodsText}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">镜像规格</h3>
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
