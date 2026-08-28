// 沙箱启动中进度（P20 §3.3）：四阶段 + 进度条。纯展示、props 驱动、零副作用。
// 冷启可能到 ~220s（镜像未预装 CLI 时现装实测可达 753s）：进度条随阶段推进但不到 100%，
// 配合当前阶段脉冲 + 子文案，避免"卡死"观感。
//
// ⚠️ 格的**顺序由 props.phases 决定**（容器从 lib/sandboxLifecycle 取，展示序刻意 ≠ 状态机序）；
// 本视图不排序、不重排、不硬编码任何阶段名。

export interface SandboxStartupProgressProps {
  /** 四阶段标签（顺序即展示顺序，由 container 注入）。 */
  phases: readonly { key: string; label: string }[];
  /** 当前进行中的阶段下标。 */
  activeIndex: number;
  /** 进度百分比（0–100，running 前 < 100）。 */
  percent: number;
  /** 原始 status 文案（诊断用，可选）。 */
  statusLabel?: string;
  /** 后端派生的默认任务名（10 §7.3 SandboxDto.name）；前端不自己派生。 */
  taskName?: string;
  /**
   * 挂在某一格下的子文案（来源：起实例的 `sandbox.instance_progress` 与装 CLI 的
   * `runtime.install_progress`，两者都挂「启动实例」格）。视图只按 phaseKey 找格子渲染，
   * 不关心它是谁产的、也不做仲裁。
   */
  phaseNote?: { phaseKey: string; text: string };
  /**
   * 当前阶段「已等待」的显示串（`3:10`），渲染在**进行中**那一格的标签右侧。
   *
   * ⚠️ 缺席就是不渲染，视图**不许兜底成 `0:00`**：容器给不出这个串只有一种情况——
   * 它拿不到可信的计时锚点（刷新恢复出来的状态没有"何时进入"这回事）。补一个 0 会把
   * 「不知道等了多久」显示成「刚开始等」，而这两件事对着一个已经等了三分钟的用户，
   * 差别正是这张卡存在的全部理由。
   */
  activeElapsedLabel?: string;
}

export function SandboxStartupProgressView({
  phases,
  activeIndex,
  percent,
  statusLabel,
  taskName,
  phaseNote,
  activeElapsedLabel,
}: SandboxStartupProgressProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <div>
        <h2 className="text-lg font-semibold">
          {taskName !== undefined && taskName !== '' ? `正在启动：${taskName}` : '正在启动沙箱…'}
        </h2>
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
            const note = phaseNote?.phaseKey === phase.key ? phaseNote.text : null;
            return (
              <li key={phase.key} className="flex flex-col gap-1 text-sm">
                <span className="flex items-center gap-2">
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
                  <span
                    className={state === 'pending' ? 'text-muted-foreground' : 'text-foreground'}
                  >
                    {phase.label}
                  </span>
                  {state === 'active' && activeElapsedLabel !== undefined && (
                    <span
                      data-testid="phase-elapsed"
                      className="font-mono text-xs tabular-nums text-muted-foreground"
                    >
                      {activeElapsedLabel}
                    </span>
                  )}
                </span>
                {note !== null && (
                  <span
                    data-testid={`phase-note-${phase.key}`}
                    className="pl-6 text-xs text-muted-foreground"
                  >
                    {note}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
