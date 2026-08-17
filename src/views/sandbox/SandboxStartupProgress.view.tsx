// 沙箱启动中进度（P20 §3.3）：四阶段 + 进度条。纯展示、props 驱动、零副作用。
// 冷启可能到 ~220s：进度条随阶段推进但不到 100%，配合当前阶段脉冲，避免"卡死"观感。

export interface SandboxStartupProgressProps {
  /** 四阶段标签（顺序即进度顺序）。 */
  phases: readonly { key: string; label: string }[];
  /** 当前进行中的阶段下标。 */
  activeIndex: number;
  /** 进度百分比（0–100，running 前 < 100）。 */
  percent: number;
  /** 原始 status 文案（诊断用，可选）。 */
  statusLabel?: string;
}

export function SandboxStartupProgressView({
  phases,
  activeIndex,
  percent,
  statusLabel,
}: SandboxStartupProgressProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <div>
        <h2 className="text-lg font-semibold">正在启动沙箱…</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          首次启动需拉取镜像，可能耗时较长，请稍候
          {statusLabel !== undefined && statusLabel !== '' ? `（${statusLabel}）` : ''}
        </p>
      </div>

      <div className="w-full max-w-sm" role="status" aria-live="polite">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${String(Math.min(Math.max(percent, 0), 100))}%` }}
          />
        </div>

        <ol className="mt-4 flex flex-col gap-2 text-left">
          {phases.map((phase, i) => {
            const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending';
            return (
              <li key={phase.key} className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className={
                    state === 'done'
                      ? 'text-primary'
                      : state === 'active'
                        ? 'animate-pulse text-primary'
                        : 'text-muted-foreground'
                  }
                >
                  {state === 'done' ? '✓' : state === 'active' ? '●' : '○'}
                </span>
                <span className={state === 'pending' ? 'text-muted-foreground' : 'text-foreground'}>
                  {phase.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
