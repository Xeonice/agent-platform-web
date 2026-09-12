// 终端仪表壳内的工具栏行（design-notes.md §4 Phase 3 / 原型 `.terminal-shell` 内：
// 面包屑 `ProjectA / Codex · 任务名` + 右侧 [复制] [清屏] [A-] [A+]）。
//
// ⚠️ **原型多画了一个 [+ 新标签]，这里刻意不复刻**：多标签在这套代码里已经真的做完了
// （`TerminalTabBarView` 的 [+ 新终端]，标签栏本身在仪表壳**外面**、tabs 之上），
// 原型那个按钮是它还没落地时的占位设计。真做出来会有两个「加一个终端」的入口并存，
// 一个在标签栏、一个在仪表壳里——这不是更贴近原型，是引入一个真实的重复入口。
// 偏离已回填 design-notes.md（见本轮报告）。
//
// 纯展示、props 驱动、零副作用（07 §3 规则 1）：复制/清屏/字号变化的真实逻辑（读写
// xterm 实例、写剪贴板）都在 container 层（`TerminalMount`），这里只负责按钮与回调。
import { Button } from '@/components/ui/button';

export interface TerminalToolbarProps {
  /** `${项目名} / ${任务名}`（原型 `renderTerminal()`：`${t.project} / ${t.name}`）。 */
  breadcrumb: string;
  onCopy: () => void;
  onClear: () => void;
  onDecreaseFontSize: () => void;
  onIncreaseFontSize: () => void;
  /** 字号已到下限/上限时置灰，而不是无提示地什么也不做。 */
  canDecreaseFontSize?: boolean;
  canIncreaseFontSize?: boolean;
}

export function TerminalToolbarView({
  breadcrumb,
  onCopy,
  onClear,
  onDecreaseFontSize,
  onIncreaseFontSize,
  canDecreaseFontSize = true,
  canIncreaseFontSize = true,
}: TerminalToolbarProps) {
  return (
    <div
      className="flex flex-none items-center justify-between gap-2 px-1"
      data-testid="terminal-toolbar"
    >
      <span
        className="truncate font-mono text-[11px] text-foreground-subtle"
        data-testid="terminal-toolbar-breadcrumb"
        title={breadcrumb}
      >
        {breadcrumb}
      </span>
      <div className="flex flex-none items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          data-testid="terminal-toolbar-copy"
          onClick={onCopy}
        >
          复制
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          data-testid="terminal-toolbar-clear"
          onClick={onClear}
        >
          清屏
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          data-testid="terminal-toolbar-font-decrease"
          aria-label="缩小字号"
          disabled={!canDecreaseFontSize}
          onClick={onDecreaseFontSize}
        >
          A-
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          data-testid="terminal-toolbar-font-increase"
          aria-label="放大字号"
          disabled={!canIncreaseFontSize}
          onClick={onIncreaseFontSize}
        >
          A+
        </Button>
      </div>
    </div>
  );
}
