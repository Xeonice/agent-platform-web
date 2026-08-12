// 仅持有 <div ref> 容器（实例活在 registry，08 §7.4）。零副作用、零逻辑。
import { forwardRef } from 'react';

export interface TerminalPaneProps {
  /** 空态：无选中会话时渲染引导文案而非空白（08 §2.2）。 */
  empty?: boolean;
  emptyHint?: string;
}

export const TerminalPaneView = forwardRef<HTMLDivElement, TerminalPaneProps>(
  ({ empty = false, emptyHint = '选择左侧的一个任务以打开终端' }, ref) => {
    if (empty) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {emptyHint}
        </div>
      );
    }
    return <div ref={ref} className="h-full w-full bg-terminal" data-testid="terminal-container" />;
  },
);
TerminalPaneView.displayName = 'TerminalPaneView';
