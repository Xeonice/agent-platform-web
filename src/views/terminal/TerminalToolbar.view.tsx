// 终端栏右侧工具，操作对象由活动会话的 TerminalMount 提供（f-wb-live-01）。
import { AArrowDown, AArrowUp, Copy, Eraser } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface TerminalToolbarProps {
  onCopy: () => void;
  onClear: () => void;
  onDecreaseFontSize: () => void;
  onIncreaseFontSize: () => void;
  canDecreaseFontSize?: boolean;
  canIncreaseFontSize?: boolean;
}

export function TerminalToolbarView({
  onCopy,
  onClear,
  onDecreaseFontSize,
  onIncreaseFontSize,
  canDecreaseFontSize = true,
  canIncreaseFontSize = true,
}: TerminalToolbarProps) {
  return (
    <div
      className="flex shrink-0 items-center gap-0.5"
      data-testid="terminal-toolbar"
      role="group"
      aria-label="当前终端工具"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-[var(--v2-foreground-muted)] hover:text-foreground"
        aria-label="复制"
        title="复制"
        data-testid="terminal-toolbar-copy"
        onClick={onCopy}
      >
        <Copy aria-hidden="true" className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-[var(--v2-foreground-muted)] hover:text-foreground"
        aria-label="清屏"
        title="清屏"
        data-testid="terminal-toolbar-clear"
        onClick={onClear}
      >
        <Eraser aria-hidden="true" className="size-3.5" />
      </Button>
      <span aria-hidden="true" className="mx-1.5 h-4 w-px bg-[var(--v2-border)]" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-[var(--v2-foreground-muted)] hover:text-foreground"
        aria-label="缩小字号"
        title="缩小字号"
        data-testid="terminal-toolbar-font-decrease"
        disabled={!canDecreaseFontSize}
        onClick={onDecreaseFontSize}
      >
        <AArrowDown aria-hidden="true" className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 text-[var(--v2-foreground-muted)] hover:text-foreground"
        aria-label="放大字号"
        title="放大字号"
        data-testid="terminal-toolbar-font-increase"
        disabled={!canIncreaseFontSize}
        onClick={onIncreaseFontSize}
      >
        <AArrowUp aria-hidden="true" className="size-3.5" />
      </Button>
    </div>
  );
}
